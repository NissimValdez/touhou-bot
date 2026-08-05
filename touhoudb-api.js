const CONFIG = {
    baseUrl: 'https://touhoudb.com/api',
    userAgent: 'TouhouBot/1.0 (https://github.com/NissimValdez/touhou-bot)',
    cacheDuration: 3600000,
    maxRetries: 3,
    retryDelay: 1000,
    rateLimit: {
        requestPerMinute: 30,
        requestPerDay: 1000
    }
};

const ENDPOINT_CONFIG = {
    songs: {
        allowedFields: ['Albums', 'Artists', 'MainPicture', 'Names', 'PVs', 'Tags', 'WebLinks'],
        maxResults: 10,
        description: 'Search for songs'
    },
    artists: {
        allowedFields: ['AdditionalNames', 'ArtistLinks', 'MainPicture', 'Names', 'Tags', 'WebLinks'],
        maxResults: 3,
        description: 'Search for artists'
    },
    albums: {
        allowedFields: ['AdditionalNames', 'Artists', 'MainPicture', 'Names', 'PVs', 'Tags', 'Tracks', 'WebLinks'],
        maxResults: 5,
        description: 'Search for albums'
    }
};

class Cache {
    constructor() {
        this.store = new Map();
    }

    get(key) {
        const entry = this.store.get(key);
        if (!entry) {
            return null;
        }

        if (Date.now() - entry.timestamp > CONFIG.cacheDuration) {
            this.store.delete(key);
            return null;
        }

        return entry.data;
    }

    set(key, data) {
        this.store.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    clear() {
        this.store.clear();
    }
}

class RateLimiter {
    constructor() {
        this.requests = [];
        this.dailyRequests = 0;
        this.dailyReset = Date.now() + 86400000;
    }

    canMakeRequest() {
        const now = Date.now(); 

        this.requests = this.requests.filter(time => now - time < 60000);

        if (now > this.dailyReset) {
            this.dailyRequests = 0;
            this.dailyReset = now + 86400000;
        }

        if (this.requests.length >= CONFIG.rateLimit.requestPerMinute) {
            return { allowed: false, reason: 'Minute limit reached' };
        }

        if (this.dailyRequests >= CONFIG.rateLimit.requestPerDay) {
            return { allowed: false, reason: 'Daily limit reached' };
        }

        return { allowed: true };
    }

    recordRequest() {
        this.requests.push(Date.now());
        this.dailyRequests++;
    }

    getStats() {
        const now = Date.now();
        const recentRequests = this.requests.filter(time => now - time < 60000);

        return {
            requestsThisMinute: recentRequests.length,
            requestsToday: this.dailyRequests,
            maxPerMinute: CONFIG.rateLimit.requestPerMinute,
            maxPerDay: CONFIG.rateLimit.requestPerDay
        };
    }
}

const cache = new Cache();
const rateLimiter = new RateLimiter();

async function searchTouhouDB(endpoint, query, options = {}) {
    const config = ENDPOINT_CONFIG[endpoint];
    if (!config) {
        throw new Error(`Unknown endpoint: ${endpoint}. Available: ${Object.keys(ENDPOINT_CONFIG).join(', ')}`);
    }

    const {
        maxResults = config.maxResults,
        fields = 'Artists,Albums,MainPicture',
        lang = 'Default',
        getTotalCount = false,
        start = 0,
        sort = 'Name',
        nameMatchMode = 'Auto',
        ...extraParams
    } = options;

    if (fields) {
        const requestedFields = fields.split(',');
        const invalid = requestedFields.filter(f => !config.allowedFields.includes(f.trim()));

        if (invalid.length > 0) {
            console.warn(`[Warning] Invalid fields for ${endpoint}: ${invalid.join(', ')}`);
        }
    }

    const rateCheck = rateLimiter.canMakeRequest();
    if (!rateCheck.allowed) {
        throw new Error(`Rate limit exceeded: ${rateCheck.reason}`);
    }

    const cacheKey = `${endpoint}:${query}:${maxResults}:${fields}:${lang}:${start}:${sort}:${nameMatchMode}:${JSON.stringify(extraParams)}`;

    const cachedData = cache.get(cacheKey);
    if (cachedData) {
        console.log(`[Cache] Returning cached ${endpoint} results for "${query}"`);
        return cachedData;
    }

    const url = new URL(`${CONFIG.baseUrl}/${endpoint}`);

    if (query) {
        url.searchParams.append('query', query);
    }

    url.searchParams.append('maxResults', maxResults.toString());
    url.searchParams.append('fields', fields);
    url.searchParams.append('lang', lang);
    url.searchParams.append('start', start.toString());
    url.searchParams.append('getTotalCount', getTotalCount.toString());
    url.searchParams.append('sort', sort);
    url.searchParams.append('nameMatchMode', nameMatchMode);

    for (const [key, value] of Object.entries(extraParams)) {
        if (value === undefined || value === null) {
            continue;
        }

        if (Array.isArray(value)) {
            if(value.length === 0) {
                continue;
            }
            for (const item of value) {
                url.searchParams.append(`${key}[]`, item.toString());
            }
        } else {
            url.searchParams.append(key, value.toString());
        }
    }

    console.log(`[API] searching TouhouDB ${endpoint}: "${query}"`);

    let lastError;
    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
        try {
            const response = await fetch(url.toString(), {
                headers: {
                    'User-Agent': CONFIG.userAgent
                }
            });

            rateLimiter.recordRequest();

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            cache.set(cacheKey, data);
            return data;

        } catch (error) {
            lastError = error;
            console.warn(`[API] attempt ${attempt}/${CONFIG.maxRetries} failed:`, error.message);

            if (attempt < CONFIG.maxRetries) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay * attempt));
            }
        }
    }

    throw new Error(`Failed after ${CONFIG.maxRetries} attempts: ${lastError.message}`);
}

function searchSongs(query, options = {}) {
    return searchTouhouDB('songs', query, options);
}

function searchArtists(query, options = {}) {
    return searchTouhouDB('artists', query, options);
}

function searchAlbums(query, options = {}) {
    return searchTouhouDB('albums', query, options);
}

function getEndpointConfig(endpoint) {
    return ENDPOINT_CONFIG[endpoint];
}

function getRateLimitStats() {
    return rateLimiter.getStats();
}

function clearCache() {
    cache.clear();
    console.log('[Cache] Cleared');
}

module.exports = {
    searchSongs,
    searchArtists,
    searchAlbums,
    searchTouhouDB,
    getEndpointConfig,
    getRateLimitStats,
    clearCache,
    CONFIG,
    ENDPOINT_CONFIG
};