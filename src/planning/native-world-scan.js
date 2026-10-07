/* 酒馆 1.18.0 世界书扫描核心的私有作用域适配。源代码 AGPL-3.0，见 THIRD_PARTY_NOTICES.md。
 * 修改：宿主依赖由 ports 注入；随机源和日志隔离；不导入或改变酒馆原生扫描状态。 */
export function createNativeScanner(ports) {
const {settings, metadata:chat_metadata, entries, context, expand, tokenize, random} = ports;
const {world_info_depth=2,world_info_min_activations=0,world_info_min_activations_depth_max=0,world_info_budget=25,world_info_include_names=true,world_info_recursive=false,world_info_case_sensitive=false,world_info_match_whole_words=false,world_info_use_group_scoring=false,world_info_budget_cap=0,world_info_max_recursion_steps=0} = settings;
const world_info_overflow_alert=false;
const console={debug(){},log(){},warn(){},error(){},table(){}};
const Math=Object.create(globalThis.Math); Math.random=random;
const MAX_SCAN_DEPTH=1000, DEFAULT_DEPTH=4, DEFAULT_WEIGHT=100;
const KNOWN_DECORATORS=['@@activate','@@dont_activate'];
const scan_state={NONE:0,INITIAL:1,RECURSION:2,MIN_ACTIVATIONS:3};
const world_info_logic={AND_ANY:0,NOT_ALL:1,NOT_ANY:2,AND_ALL:3};
const world_info_position={before:0,after:1,ANTop:2,ANBottom:3,atDepth:4,EMTop:5,EMBottom:6,outlet:7};
const wi_anchor_position={before:0,after:1};
const extension_prompt_roles={SYSTEM:0,USER:1,ASSISTANT:2};
const defaultGlobalScanData={};
const sortFn=(a,b)=>b.order-a.order;
const escapeRegex=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const getContext=()=>context;
const getSortedEntries=async()=>structuredClone(entries).map(e=>{const [decorators,content]=parseDecorators(e.content||'');return {...e,decorators,content};});
const substituteParams=expand;
const getTokenCountAsync=tokenize;
const getExtensionPromptByName=async key=>expand(context.extensionPrompts[key]?.value||'');
const getCharaFilename=()=>ports.characterFile||'';
const this_chid=ports.characterId;
const getTagKeyForEntity=()=>ports.tagKey;
const eventSource={emit:async()=>{}};
const event_types={WORLDINFO_SCAN_DONE:'private-scan'};
const getRegexedString=text=>text;
const regex_placement={WORLD_INFO:5};
const shouldWIAddPrompt=false;
class WorldInfoBuffer {
    /**
     * @type {Map<string, object>} Map of entries that need to be activated no matter what
     */
    static externalActivations = new Map();

    /**
     * @type {WIGlobalScanData} Chat independent data to be scanned, such as persona and character descriptions
     */
    #globalScanData = null;

    /**
     * @type {string[]} Array of messages sorted by ascending depth
     */
    #depthBuffer = [];

    /**
     * @type {string[]} Array of strings added by recursive scanning
     */
    #recurseBuffer = [];

    /**
     * @type {string[]} Array of strings added by prompt injections that are valid for the current scan
     */
    #injectBuffer = [];

    /**
     * @type {number} The skew of the global scan depth. Used in "min activations"
     */
    #skew = 0;

    /**
     * @type {number} The starting depth of the global scan depth.
     */
    #startDepth = 0;

    /**
     * Initialize the buffer with the given messages.
     * @param {string[]} messages Array of messages to add to the buffer
     * @param {WIGlobalScanData} globalScanData Chat independent context to be scanned
     */
    constructor(messages, globalScanData) {
        this.#initDepthBuffer(messages);
        this.#globalScanData = globalScanData;
    }

    /**
     * Populates the buffer with the given messages.
     * @param {string[]} messages Array of messages to add to the buffer
     * @returns {void} Hardly seen nothing down here
     */
    #initDepthBuffer(messages) {
        for (let depth = 0; depth < MAX_SCAN_DEPTH; depth++) {
            if (messages[depth]) {
                this.#depthBuffer[depth] = messages[depth].trim();
            }
            // break if last message is reached
            if (depth === messages.length - 1) {
                break;
            }
        }
    }

    /**
     * Gets a string that respects the case sensitivity setting
     * @param {string} str The string to transform
     * @param {WIScanEntry} entry The entry that triggered the scan
     * @returns {string} The transformed string
    */
    #transformString(str, entry) {
        const caseSensitive = entry.caseSensitive ?? world_info_case_sensitive;
        return caseSensitive ? str : str.toLowerCase();
    }

    /**
     * Gets all messages up to the given depth + recursion buffer.
     * @param {WIScanEntry} entry The entry that triggered the scan
     * @param {number} scanState The state of the scan
     * @returns {string} A slice of buffer until the given depth (inclusive)
     */
    get(entry, scanState) {
        let depth = entry.scanDepth ?? this.getDepth();
        if (depth <= this.#startDepth) {
            return '';
        }

        if (depth < 0) {
            console.error(`[WI] Invalid WI scan depth ${depth}. Must be >= 0`);
            return '';
        }

        if (depth > MAX_SCAN_DEPTH) {
            console.warn(`[WI] Invalid WI scan depth ${depth}. Truncating to ${MAX_SCAN_DEPTH}`);
            depth = MAX_SCAN_DEPTH;
        }

        const MATCHER = '\x01';
        const JOINER = '\n' + MATCHER;
        let result = MATCHER + this.#depthBuffer.slice(this.#startDepth, depth).join(JOINER);

        if (entry.matchPersonaDescription && this.#globalScanData.personaDescription) {
            result += JOINER + this.#globalScanData.personaDescription;
        }
        if (entry.matchCharacterDescription && this.#globalScanData.characterDescription) {
            result += JOINER + this.#globalScanData.characterDescription;
        }
        if (entry.matchCharacterPersonality && this.#globalScanData.characterPersonality) {
            result += JOINER + this.#globalScanData.characterPersonality;
        }
        if (entry.matchCharacterDepthPrompt && this.#globalScanData.characterDepthPrompt) {
            result += JOINER + this.#globalScanData.characterDepthPrompt;
        }
        if (entry.matchScenario && this.#globalScanData.scenario) {
            result += JOINER + this.#globalScanData.scenario;
        }
        if (entry.matchCreatorNotes && this.#globalScanData.creatorNotes) {
            result += JOINER + this.#globalScanData.creatorNotes;
        }

        if (this.#injectBuffer.length > 0) {
            result += JOINER + this.#injectBuffer.join(JOINER);
        }

        // Min activations should not include the recursion buffer
        if (this.#recurseBuffer.length > 0 && scanState !== scan_state.MIN_ACTIVATIONS) {
            result += JOINER + this.#recurseBuffer.join(JOINER);
        }

        return result;
    }

    /**
     * Matches the given string against the buffer.
     * @param {string} haystack The string to search in
     * @param {string} needle The string to search for
     * @param {WIScanEntry} entry The entry that triggered the scan
     * @returns {boolean} True if the string was found in the buffer
     */
    matchKeys(haystack, needle, entry) {
        // If the needle is a regex, we do regex pattern matching and override all the other options
        const keyRegex = parseRegexFromString(needle);
        if (keyRegex) {
            return keyRegex.test(haystack);
        }

        // Otherwise we do normal matching of plaintext with the chosen entry settings
        haystack = this.#transformString(haystack, entry);
        const transformedString = this.#transformString(needle, entry);
        const matchWholeWords = entry.matchWholeWords ?? world_info_match_whole_words;

        if (matchWholeWords) {
            const keyWords = transformedString.split(/\s+/);

            if (keyWords.length > 1) {
                return haystack.includes(transformedString);
            } else {
                // Use custom boundaries to include punctuation and other non-alphanumeric characters
                const regex = new RegExp(`(?:^|\\W)(${escapeRegex(transformedString)})(?:$|\\W)`);
                if (regex.test(haystack)) {
                    return true;
                }
            }
        } else {
            return haystack.includes(transformedString);
        }

        return false;
    }

    /**
     * Adds a message to the recursion buffer.
     * @param {string} message The message to add
     */
    addRecurse(message) {
        this.#recurseBuffer.push(message);
    }

    /**
     * Adds an injection to the buffer.
     * @param {string} message The injection to add
     */
    addInject(message) {
        this.#injectBuffer.push(message);
    }

    /**
     * Checks if the recursion buffer is not empty.
     * @returns {boolean} Returns true if the recursion buffer is not empty, otherwise false
     */
    hasRecurse() {
        return this.#recurseBuffer.length > 0;
    }

    /**
     * Increments skew to advance the scan range.
     */
    advanceScan() {
        this.#skew++;
    }

    /**
     * @returns {number} Settings' depth + current skew.
     */
    getDepth() {
        return world_info_depth + this.#skew;
    }

    /**
     * Get the externally activated version of the entry, if there is one.
     * @param {object} entry WI entry to check
     * @returns {object|undefined} the external version if the entry is forcefully activated, undefined otherwise
     */
    getExternallyActivated(entry) {
        return WorldInfoBuffer.externalActivations.get(`${entry.world}.${entry.uid}`);
    }

    /**
     * Clean-up the external effects for entries.
     */
    resetExternalEffects() {
        WorldInfoBuffer.externalActivations = new Map();
    }

    /**
     * Gets the match score for the given entry.
     * @param {WIScanEntry} entry Entry to check
     * @param {number} scanState The state of the scan
     * @returns {number} The number of key activations for the given entry
     */
    getScore(entry, scanState) {
        const bufferState = this.get(entry, scanState);
        let numberOfPrimaryKeys = 0;
        let numberOfSecondaryKeys = 0;
        let primaryScore = 0;
        let secondaryScore = 0;

        // Increment score for every key found in the buffer
        if (Array.isArray(entry.key)) {
            numberOfPrimaryKeys = entry.key.length;
            for (const key of entry.key) {
                if (this.matchKeys(bufferState, key, entry)) {
                    primaryScore++;
                }
            }
        }

        // Increment score for every secondary key found in the buffer
        if (Array.isArray(entry.keysecondary)) {
            numberOfSecondaryKeys = entry.keysecondary.length;
            for (const key of entry.keysecondary) {
                if (this.matchKeys(bufferState, key, entry)) {
                    secondaryScore++;
                }
            }
        }

        // No keys == no score
        if (!numberOfPrimaryKeys) {
            return 0;
        }

        // Only positive logic influences the score
        if (numberOfSecondaryKeys > 0) {
            switch (entry.selectiveLogic) {
                // AND_ANY: Add both scores
                case world_info_logic.AND_ANY:
                    return primaryScore + secondaryScore;
                // AND_ALL: Add both scores if all secondary keys are found, otherwise only primary score
                case world_info_logic.AND_ALL:
                    return secondaryScore === numberOfSecondaryKeys ? primaryScore + secondaryScore : primaryScore;
            }
        }

        return primaryScore;
    }
}

/**
 * Represents a timed effects manager for World Info.
 */
class WorldInfoTimedEffects {
    /**
     * Array of chat messages.
     * @type {string[]}
     */
    #chat = [];

    /**
     * Array of entries.
     * @type {WIScanEntry[]}
     */
    #entries = [];

    /**
     * Is this a dry run?
     * @type {boolean}
     */
    #isDryRun = false;

    /**
     * Buffer for active timed effects.
     * @type {Record<TimedEffectType, WIScanEntry[]>}
     */
    #buffer = {
        'sticky': [],
        'cooldown': [],
        'delay': [],
    };

    /**
     * Callbacks for effect types ending.
     * @type {Record<TimedEffectType, (entry: WIScanEntry) => void>}
     */
    #onEnded = {
        /**
         * Callback for when a sticky entry ends.
         * Sets an entry on cooldown immediately if it has a cooldown.
         * @param {WIScanEntry} entry Entry that ended sticky
         */
        'sticky': (entry) => {
            if (!entry.cooldown) {
                return;
            }

            const key = this.#getEntryKey(entry);
            const effect = this.#getEntryTimedEffect('cooldown', entry, true);
            chat_metadata.timedWorldInfo.cooldown[key] = effect;
            console.log(`[WI] Adding cooldown entry ${key} on ended sticky: start=${effect.start}, end=${effect.end}, protected=${effect.protected}`);
            // Set the cooldown immediately for this evaluation
            this.#buffer.cooldown.push(entry);
        },

        /**
         * Callback for when a cooldown entry ends.
         * No-op, essentially.
         * @param {WIScanEntry} entry Entry that ended cooldown
         */
        'cooldown': (entry) => {
            console.debug('[WI] Cooldown ended for entry', entry.uid);
        },

        'delay': () => { },
    };

    /**
     * Initialize the timed effects with the given messages.
     * @param {string[]} chat Array of chat messages
     * @param {WIScanEntry[]} entries Array of entries
     * @param {boolean} isDryRun Whether the operation is a dry run
     */
    constructor(chat, entries, isDryRun = false) {
        this.#chat = chat;
        this.#entries = entries;
        this.#isDryRun = isDryRun;
        this.#ensureChatMetadata();
    }

    /**
     * Verify correct structure of chat metadata.
     */
    #ensureChatMetadata() {
        if (!chat_metadata.timedWorldInfo) {
            chat_metadata.timedWorldInfo = {};
        }

        ['sticky', 'cooldown'].forEach(type => {
            // Ensure the property exists and is an object
            if (!chat_metadata.timedWorldInfo[type] || typeof chat_metadata.timedWorldInfo[type] !== 'object') {
                chat_metadata.timedWorldInfo[type] = {};
            }

            // Clean up invalid entries
            Object.entries(chat_metadata.timedWorldInfo[type]).forEach(([key, value]) => {
                if (!value || typeof value !== 'object') {
                    delete chat_metadata.timedWorldInfo[type][key];
                }
            });
        });
    }

    /**
    * Gets a hash for a WI entry.
    * @param {WIScanEntry} entry WI entry
    * @returns {number} String hash
    */
    #getEntryHash(entry) {
        return entry.hash;
    }

    /**
     * Gets a unique-ish key for a WI entry.
     * @param {WIScanEntry} entry WI entry
     * @returns {string} String key for the entry
     */
    #getEntryKey(entry) {
        return `${entry.world}.${entry.uid}`;
    }

    /**
     * Gets a timed effect for a WI entry.
     * @param {TimedEffectType} type Type of timed effect
     * @param {WIScanEntry} entry WI entry
     * @param {boolean} isProtected If the effect should be protected
     * @returns {WITimedEffect} Timed effect for the entry
     */
    #getEntryTimedEffect(type, entry, isProtected) {
        return {
            hash: this.#getEntryHash(entry),
            start: this.#chat.length,
            end: this.#chat.length + Number(entry[type]),
            protected: !!isProtected,
        };
    }

    /**
     * Processes entries for a given type of timed effect.
     * @param {TimedEffectType} type Identifier for the type of timed effect
     * @param {WIScanEntry[]} buffer Buffer to store the entries
     * @param {(entry: WIScanEntry) => void} onEnded Callback for when a timed effect ends
     */
    #checkTimedEffectOfType(type, buffer, onEnded) {
        /** @type {[string, WITimedEffect][]} */
        const effects = Object.entries(chat_metadata.timedWorldInfo[type]);
        for (const [key, value] of effects) {
            console.log(`[WI] Processing ${type} entry ${key}`, value);
            const entry = this.#entries.find(x => String(this.#getEntryHash(x)) === String(value.hash));

            if (this.#chat.length <= Number(value.start) && !value.protected) {
                console.log(`[WI] Removing ${type} entry ${key} from timedWorldInfo: chat not advanced`, value);
                delete chat_metadata.timedWorldInfo[type][key];
                continue;
            }

            // Missing entries (they could be from another character's lorebook)
            if (!entry) {
                if (this.#chat.length >= Number(value.end)) {
                    console.log(`[WI] Removing ${type} entry from timedWorldInfo: entry not found and interval passed`, entry);
                    delete chat_metadata.timedWorldInfo[type][key];
                }
                continue;
            }

            // Ignore invalid entries (not configured for timed effects)
            if (!entry[type]) {
                console.log(`[WI] Removing ${type} entry from timedWorldInfo: entry not ${type}`, entry);
                delete chat_metadata.timedWorldInfo[type][key];
                continue;
            }

            if (this.#chat.length >= Number(value.end)) {
                console.log(`[WI] Removing ${type} entry from timedWorldInfo: ${type} interval passed`, entry);
                delete chat_metadata.timedWorldInfo[type][key];
                if (typeof onEnded === 'function') {
                    onEnded(entry);
                }
                continue;
            }

            buffer.push(entry);
            console.log(`[WI] Timed effect "${type}" applied to entry`, entry);
        }
    }

    /**
     * Processes entries for the "delay" timed effect.
     * @param {WIScanEntry[]} buffer Buffer to store the entries
     */
    #checkDelayEffect(buffer) {
        for (const entry of this.#entries) {
            if (!entry.delay) {
                continue;
            }

            if (this.#chat.length < entry.delay) {
                buffer.push(entry);
                console.log('[WI] Timed effect "delay" applied to entry', entry);
            }
        }
    }

    /**
     * Checks for timed effects on chat messages.
     */
    checkTimedEffects() {
        if (!this.#isDryRun) {
            this.#checkTimedEffectOfType('sticky', this.#buffer.sticky, this.#onEnded.sticky.bind(this));
            this.#checkTimedEffectOfType('cooldown', this.#buffer.cooldown, this.#onEnded.cooldown.bind(this));
        }
        this.#checkDelayEffect(this.#buffer.delay);
    }

    /**
     * Gets raw timed effect metadatum for a WI entry.
     * @param {TimedEffectType} type Type of timed effect
     * @param {WIScanEntry} entry WI entry
     * @returns {WITimedEffect} Timed effect for the entry
     */
    getEffectMetadata(type, entry) {
        if (!this.isValidEffectType(type)) {
            return null;
        }

        const key = this.#getEntryKey(entry);
        return chat_metadata.timedWorldInfo[type][key];
    }

    /**
     * Sets a timed effect for a WI entry.
     * @param {TimedEffectType} type Type of timed effect
     * @param {WIScanEntry} entry WI entry to check
     */
    #setTimedEffectOfType(type, entry) {
        // Skip if entry does not have the type (sticky or cooldown)
        if (!entry[type]) {
            return;
        }

        const key = this.#getEntryKey(entry);

        if (!chat_metadata.timedWorldInfo[type][key]) {
            const effect = this.#getEntryTimedEffect(type, entry, false);
            chat_metadata.timedWorldInfo[type][key] = effect;

            console.log(`[WI] Adding ${type} entry ${key}: start=${effect.start}, end=${effect.end}, protected=${effect.protected}`);
        }
    }

    /**
     * Sets timed effects on chat messages.
     * @param {WIScanEntry[]} activatedEntries Entries that were activated
     */
    setTimedEffects(activatedEntries) {
        if (this.#isDryRun) return;
        for (const entry of activatedEntries) {
            this.#setTimedEffectOfType('sticky', entry);
            this.#setTimedEffectOfType('cooldown', entry);
        }
    }

    /**
     * Force set a timed effect for a WI entry.
     * @param {TimedEffectType} type Type of timed effect
     * @param {WIScanEntry} entry WI entry
     * @param {boolean} newState The state of the effect
     */
    setTimedEffect(type, entry, newState) {
        if (!this.isValidEffectType(type)) {
            return;
        }
        if (this.#isDryRun && type !== 'delay') {
            return;
        }

        const key = this.#getEntryKey(entry);
        delete chat_metadata.timedWorldInfo[type][key];

        if (newState) {
            const effect = this.#getEntryTimedEffect(type, entry, false);
            chat_metadata.timedWorldInfo[type][key] = effect;
            console.log(`[WI] Adding ${type} entry ${key}: start=${effect.start}, end=${effect.end}, protected=${effect.protected}`);
        }
    }

    /**
     * Check if the string is a valid timed effect type.
     * @param {string} type Name of the timed effect
     * @returns {boolean} Is recognized type
     */
    isValidEffectType(type) {
        return typeof type === 'string' && ['sticky', 'cooldown', 'delay'].includes(type.trim().toLowerCase());
    }

    /**
     * Check if the current entry is sticky activated.
     * @param {TimedEffectType} type Type of timed effect
     * @param {WIScanEntry} entry WI entry to check
     * @returns {boolean} True if the entry is active
     */
    isEffectActive(type, entry) {
        if (!this.isValidEffectType(type)) {
            return false;
        }

        return this.#buffer[type]?.some(x => this.#getEntryHash(x) === this.#getEntryHash(entry)) ?? false;
    }

    /**
     * Clean-up previously set timed effects.
     */
    cleanUp() {
        for (const buffer of Object.values(this.#buffer)) {
            buffer.splice(0, buffer.length);
        }
    }
}


function parseRegexFromString(input) {
    // Extracting the regex pattern and flags
    let match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) {
        return null; // Not a valid regex format
    }

    let [, pattern, flags] = match;

    // If we find any unescaped slash delimiter, we also exit out.
    // JS doesn't care about delimiters inside regex patterns, but for this to be a valid regex outside of our implementation,
    // we have to make sure that our delimiter is correctly escaped. Or every other engine would fail.
    if (pattern.match(/(^|[^\\])\//)) {
        return null;
    }

    // Now we need to actually unescape the slash delimiters, because JS doesn't care about delimiters
    pattern = pattern.replace('\\/', '/');

    // Then we return the regex. If it fails, it was invalid syntax.
    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        return null;
    }
}


function parseDecorators(content) {
    /**
     * Check if the decorator is known
     * @param {string} data string to check
     * @returns {boolean} true if the decorator is known
    */
    const isKnownDecorator = (data) => {
        if (data.startsWith('@@@')) {
            data = data.substring(1);
        }

        for (let i = 0; i < KNOWN_DECORATORS.length; i++) {
            if (data.startsWith(KNOWN_DECORATORS[i])) {
                return true;
            }
        }
        return false;
    };

    if (content.startsWith('@@')) {
        let newContent = content;
        const splited = content.split('\n');
        let decorators = [];
        let fallbacked = false;

        for (let i = 0; i < splited.length; i++) {
            if (splited[i].startsWith('@@')) {
                if (splited[i].startsWith('@@@') && !fallbacked) {
                    continue;
                }

                if (isKnownDecorator(splited[i])) {
                    decorators.push(splited[i].startsWith('@@@') ? splited[i].substring(1) : splited[i]);
                    fallbacked = false;
                } else {
                    fallbacked = true;
                }
            } else {
                newContent = splited.slice(i).join('\n');
                break;
            }
        }
        return [decorators, newContent];
    }

    return [[], content];
}

/**
 * Performs a scan on the chat and returns the world info activated.
 * @param {string[]} chat The chat messages to scan, in reverse order.
 * @param {number} maxContext The maximum context size of the generation.
 * @param {boolean} isDryRun Whether to perform a dry run.
 * @param {WIGlobalScanData} globalScanData Chat independent context to be scanned
 * @returns {Promise<WIActivated>} The world info activated.
 */
//MARK: checkWorldInfo
async function checkWorldInfo(chat, maxContext, isDryRun, globalScanData = defaultGlobalScanData) {
    const context = getContext();
    const buffer = new WorldInfoBuffer(chat, globalScanData);

    console.debug(`[WI] --- START WI SCAN (on ${chat.length} messages, trigger = ${globalScanData.trigger})${isDryRun ? ' (DRY RUN)' : ''} ---`);

    // Combine the chat

    // Add the depth or AN if enabled
    // Put this code here since otherwise, the chat reference is modified
    for (const key of Object.keys(context.extensionPrompts)) {
        if (context.extensionPrompts[key]?.scan) {
            const prompt = await getExtensionPromptByName(key);
            if (prompt) {
                buffer.addInject(prompt);
            }
        }
    }

    /** @type {scan_state} */
    let scanState = scan_state.INITIAL;
    let token_budget_overflowed = false;
    let count = 0;
    let allActivatedEntries = new Map();
    let failedProbabilityChecks = new Set();
    let allActivatedText = '';

    let budget = Math.round(world_info_budget * maxContext / 100) || 1;

    if (world_info_budget_cap > 0 && budget > world_info_budget_cap) {
        console.debug(`[WI] Budget ${budget} exceeds cap ${world_info_budget_cap}, using cap`);
        budget = world_info_budget_cap;
    }

    console.debug(`[WI] Context size: ${maxContext}; WI budget: ${budget} (max% = ${world_info_budget}%, cap = ${world_info_budget_cap})`);
    const sortedEntries = await getSortedEntries();
    const timedEffects = new WorldInfoTimedEffects(chat, sortedEntries, isDryRun);

    timedEffects.checkTimedEffects();

    if (sortedEntries.length === 0) {
        return { worldInfoBefore: '', worldInfoAfter: '', WIDepthEntries: [], EMEntries: [], ANBeforeEntries: [], ANAfterEntries: [], outletEntries: {}, allActivatedEntries: new Set() };
    }

    /** @type {number[]} Represents the delay levels for entries that are delayed until recursion */
    const availableRecursionDelayLevels = [...new Set(sortedEntries
        .filter(entry => entry.delayUntilRecursion)
        .map(entry => entry.delayUntilRecursion === true ? 1 : entry.delayUntilRecursion),
    )].sort((a, b) => a - b);
    // Already preset with the first level
    let currentRecursionDelayLevel = availableRecursionDelayLevels.shift() ?? 0;
    if (currentRecursionDelayLevel > 0 && availableRecursionDelayLevels.length) {
        console.debug('[WI] Preparing first delayed recursion level', currentRecursionDelayLevel, '. Still delayed:', availableRecursionDelayLevels);
    }

    console.debug(`[WI] --- SEARCHING ENTRIES (on ${sortedEntries.length} entries) ---`);

    while (scanState) {
        //if world_info_max_recursion_steps is non-zero min activations are disabled, and vice versa
        if (world_info_max_recursion_steps && world_info_max_recursion_steps <= count) {
            console.debug('[WI] Search stopped by reaching max recursion steps', world_info_max_recursion_steps);
            break;
        }

        // Track how many times the loop has run. May be useful for debugging.
        count++;

        console.debug(`[WI] --- LOOP #${count} START ---`);
        console.debug('[WI] Scan state', Object.entries(scan_state).find(x => x[1] === scanState));

        // Until decided otherwise, we set the loop to stop scanning after this
        let nextScanState = scan_state.NONE;

        // Loop and find all entries that can activate here
        let activatedNow = new Set();

        for (const entry of sortedEntries) {
            // Logging preparation
            let headerLogged = false;
            function log(...args) {
                if (!headerLogged) {
                    console.debug(`[WI] Entry ${entry.uid}`, `from '${entry.world}' processing`, entry);
                    headerLogged = true;
                }
                console.debug(`[WI] Entry ${entry.uid}`, ...args);
            }

            // Already processed, considered and then skipped entries should still be skipped
            if (failedProbabilityChecks.has(entry) || allActivatedEntries.has(`${entry.world}.${entry.uid}`)) {
                continue;
            }

            if (entry.disable == true) {
                log('disabled');
                continue;
            }

            // Check for generation type trigger filter
            if (Array.isArray(entry.triggers) && entry.triggers.length > 0) {
                const isTriggered = entry.triggers.includes(globalScanData.trigger);
                if (!isTriggered) {
                    log(`skipped by generation type trigger filter (${globalScanData.trigger} ∉ ${entry.triggers})`);
                    continue;
                }
            }

            // Check if this entry applies to the character or if it's excluded
            if (entry.characterFilter && entry.characterFilter?.names?.length > 0) {
                const nameIncluded = entry.characterFilter.names.includes(getCharaFilename());
                const filtered = entry.characterFilter.isExclude ? nameIncluded : !nameIncluded;

                if (filtered) {
                    log('filtered out by character');
                    continue;
                }
            }

            if (entry.characterFilter && entry.characterFilter?.tags?.length > 0) {
                const tagKey = getTagKeyForEntity(this_chid);

                if (tagKey) {
                    const tagMapEntry = context.tagMap[tagKey];

                    if (Array.isArray(tagMapEntry)) {
                        // If tag map intersects with the tag exclusion list, skip
                        const includesTag = tagMapEntry.some((tag) => entry.characterFilter.tags.includes(tag));
                        const filtered = entry.characterFilter.isExclude ? includesTag : !includesTag;

                        if (filtered) {
                            log('filtered out by tag');
                            continue;
                        }
                    }
                }
            }

            const isSticky = timedEffects.isEffectActive('sticky', entry);
            const isCooldown = timedEffects.isEffectActive('cooldown', entry);
            const isDelay = timedEffects.isEffectActive('delay', entry);

            if (isDelay) {
                log('suppressed by delay');
                continue;
            }

            if (isCooldown && !isSticky) {
                log('suppressed by cooldown');
                continue;
            }

            // Only use checks for recursion flags if the scan step was activated by recursion
            if (scanState !== scan_state.RECURSION && entry.delayUntilRecursion && !isSticky) {
                log('suppressed by delay until recursion');
                continue;
            }

            if (scanState === scan_state.RECURSION && entry.delayUntilRecursion && entry.delayUntilRecursion > currentRecursionDelayLevel && !isSticky) {
                log('suppressed by delay until recursion level', entry.delayUntilRecursion, '. Currently', currentRecursionDelayLevel);
                continue;
            }

            if (scanState === scan_state.RECURSION && world_info_recursive && entry.excludeRecursion && !isSticky) {
                log('suppressed by exclude recursion');
                continue;
            }

            if (entry.decorators.includes('@@activate')) {
                log('activated by @@activate decorator');
                activatedNow.add(entry);
                continue;
            }

            if (entry.decorators.includes('@@dont_activate')) {
                log('suppressed by @@dont_activate decorator');
                continue;
            }

            if (buffer.getExternallyActivated(entry)) {
                log('externally activated');
                activatedNow.add(buffer.getExternallyActivated(entry));
                continue;
            }

            // Now do checks for immediate activations
            if (entry.constant) {
                log('activated because of constant');
                activatedNow.add(entry);
                continue;
            }

            if (isSticky) {
                log('activated because active sticky');
                activatedNow.add(entry);
                continue;
            }

            if (!Array.isArray(entry.key) || !entry.key.length) {
                log('has no keys defined, skipped');
                continue;
            }

            // Cache the text to scan before the loop, it won't change its content
            const textToScan = buffer.get(entry, scanState);

            // PRIMARY KEYWORDS
            let primaryKeyMatch = entry.key.find(key => {
                const substituted = substituteParams(key);
                return substituted && buffer.matchKeys(textToScan, substituted.trim(), entry);
            });

            if (!primaryKeyMatch) {
                // Don't write logs for simple no-matches
                continue;
            }

            const hasSecondaryKeywords = (
                entry.selective && //all entries are selective now
                Array.isArray(entry.keysecondary) && //always true
                entry.keysecondary.length //ignore empties
            );

            if (!hasSecondaryKeywords) {
                // Handle cases where secondary is empty
                log('activated by primary key match', primaryKeyMatch);
                activatedNow.add(entry);
                continue;
            }


            // SECONDARY KEYWORDS
            const selectiveLogic = entry.selectiveLogic ?? 0; // If selectiveLogic isn't found, assume it's AND, only do this once per entry
            log('Entry with primary key match', primaryKeyMatch, 'has secondary keywords. Checking with logic logic', Object.entries(world_info_logic).find(x => x[1] === entry.selectiveLogic));

            /** @type {() => boolean} */
            function matchSecondaryKeys() {
                let hasAnyMatch = false;
                let hasAllMatch = true;
                for (let keysecondary of entry.keysecondary) {
                    const secondarySubstituted = substituteParams(keysecondary);
                    const hasSecondaryMatch = secondarySubstituted && buffer.matchKeys(textToScan, secondarySubstituted.trim(), entry);

                    if (hasSecondaryMatch) hasAnyMatch = true;
                    if (!hasSecondaryMatch) hasAllMatch = false;

                    // Simplified AND ANY / NOT ALL if statement. (Proper fix for PR#1356 by Bronya)
                    // If AND ANY logic and the main checks pass OR if NOT ALL logic and the main checks do not pass
                    if (selectiveLogic === world_info_logic.AND_ANY && hasSecondaryMatch) {
                        log('activated. (AND ANY) Found match secondary keyword', secondarySubstituted);
                        return true;
                    }
                    if (selectiveLogic === world_info_logic.NOT_ALL && !hasSecondaryMatch) {
                        log('activated. (NOT ALL) Found not matching secondary keyword', secondarySubstituted);
                        return true;
                    }
                }

                // Handle NOT ANY logic
                if (selectiveLogic === world_info_logic.NOT_ANY && !hasAnyMatch) {
                    log('activated. (NOT ANY) No secondary keywords found', entry.keysecondary);
                    return true;
                }

                // Handle AND ALL logic
                if (selectiveLogic === world_info_logic.AND_ALL && hasAllMatch) {
                    log('activated. (AND ALL) All secondary keywords found', entry.keysecondary);
                    return true;
                }

                return false;
            }

            const matched = matchSecondaryKeys();
            if (!matched) {
                log('skipped. Secondary keywords not satisfied', entry.keysecondary);
                continue;
            }

            // Success logging was already done inside the function, so just add the entry
            activatedNow.add(entry);
            continue;
        }

        console.debug(`[WI] Search done. Found ${activatedNow.size} possible entries.`);

        // Sort the entries for the probability and the budget limit checks
        const newEntries = [...activatedNow]
            .sort((a, b) => {
                const isASticky = timedEffects.isEffectActive('sticky', a) ? 1 : 0;
                const isBSticky = timedEffects.isEffectActive('sticky', b) ? 1 : 0;
                return isBSticky - isASticky || sortedEntries.indexOf(a) - sortedEntries.indexOf(b);
            });


        let newContent = '';
        const textToScanTokens = await getTokenCountAsync(allActivatedText);

        filterByInclusionGroups(newEntries, allActivatedEntries, buffer, scanState, timedEffects);

        console.debug('[WI] --- PROBABILITY CHECKS ---');
        !newEntries.length && console.debug('[WI] No probability checks to do');

        let ignoresBudget = newEntries.filter(e => e.ignoreBudget).length;

        for (const entry of newEntries) {
            ignoresBudget -= (entry.ignoreBudget ? 1 : 0);
            if (token_budget_overflowed && !entry.ignoreBudget) {
                if (ignoresBudget > 0) {
                    continue;
                }
                break;
            }

            function verifyProbability() {
                // If we don't need to roll, it's always true
                if (!entry.useProbability || entry.probability === 100) {
                    console.debug(`WI entry ${entry.uid} does not use probability`);
                    return true;
                }

                const isSticky = timedEffects.isEffectActive('sticky', entry);
                if (isSticky) {
                    console.debug(`WI entry ${entry.uid} is sticky, does not need to re-roll probability`);
                    return true;
                }

                const rollValue = Math.random() * 100;
                if (rollValue <= entry.probability) {
                    console.debug(`WI entry ${entry.uid} passed probability check of ${entry.probability}%`);
                    return true;
                }

                failedProbabilityChecks.add(entry);
                return false;
            }

            const success = verifyProbability();
            if (!success) {
                console.debug(`WI entry ${entry.uid} failed probability check, removing from activated entries`, entry);
                continue;
            }

            // Substitute macros inline, for both this checking and also future processing
            entry.content = substituteParams(entry.content);
            newContent += `${entry.content}\n`;

            if (!entry.ignoreBudget && (textToScanTokens + (await getTokenCountAsync(newContent))) >= budget) {
                if (!token_budget_overflowed) {
                    console.debug('[WI] --- BUDGET OVERFLOW CHECK ---');
                    if (world_info_overflow_alert) {
                        console.warn(`[WI] budget of ${budget} reached, stopping after ${allActivatedEntries.size} entries`);
                        toastr.warning(`World info budget reached after ${allActivatedEntries.size} entries.`, 'World Info');
                    } else {
                        console.debug(`[WI] budget of ${budget} reached, stopping after ${allActivatedEntries.size} entries`);
                    }
                    token_budget_overflowed = true;
                }
                continue;
            }

            allActivatedEntries.set(`${entry.world}.${entry.uid}`, entry);
            console.debug(`[WI] Entry ${entry.uid} activation successful, adding to prompt`, entry);
        }

        const successfulNewEntries = newEntries.filter(x => !failedProbabilityChecks.has(x));
        const successfulNewEntriesForRecursion = successfulNewEntries.filter(x => !x.preventRecursion);

        console.debug(`[WI] --- LOOP #${count} RESULT ---`);
        if (!newEntries.length) {
            console.debug('[WI] No new entries activated.');
        } else if (!successfulNewEntries.length) {
            console.debug('[WI] Probability checks failed for all activated entries. No new entries activated.');
        } else {
            console.debug(`[WI] Successfully activated ${successfulNewEntries.length} new entries to prompt. ${allActivatedEntries.size} total entries activated.`, successfulNewEntries);
        }

        function logNextState(...args) {
            args.length && console.debug(args.shift(), ...args);
            console.debug('[WI] Setting scan state', Object.entries(scan_state).find(x => x[1] === scanState));
        }

        // After processing and rolling entries is done, see if we should continue with normal recursion
        if (world_info_recursive && !token_budget_overflowed && successfulNewEntriesForRecursion.length) {
            nextScanState = scan_state.RECURSION;
            logNextState('[WI] Found', successfulNewEntriesForRecursion.length, 'new entries for recursion');
        }

        // If we are inside min activations scan, and we have recursive buffer, we should do a recursive scan before increasing the buffer again
        // There might be recurse-trigger-able entries that match the buffer, so we need to check that
        if (world_info_recursive && !token_budget_overflowed && scanState === scan_state.MIN_ACTIVATIONS && buffer.hasRecurse()) {
            nextScanState = scan_state.RECURSION;
            logNextState('[WI] Min Activations run done, whill will always be followed by a recursive scan');
        }

        // If scanning is planned to stop, but min activations is set and not satisfied, check if we should continue
        const minActivationsNotSatisfied = world_info_min_activations > 0 && (allActivatedEntries.size < world_info_min_activations);
        if (!nextScanState && !token_budget_overflowed && minActivationsNotSatisfied) {
            console.debug('[WI] --- MIN ACTIVATIONS CHECK ---');

            let over_max = (
                world_info_min_activations_depth_max > 0 &&
                buffer.getDepth() > world_info_min_activations_depth_max
            ) || (buffer.getDepth() > chat.length);

            if (!over_max) {
                nextScanState = scan_state.MIN_ACTIVATIONS; // loop
                logNextState(`[WI] Min activations not reached (${allActivatedEntries.size}/${world_info_min_activations}), advancing depth to ${buffer.getDepth() + 1}, starting another scan`);
                buffer.advanceScan();
            } else {
                console.debug(`[WI] Min activations not reached (${allActivatedEntries.size}/${world_info_min_activations}), but reached on of depth. Stopping`);
            }
        }

        // If the scan is done, but we still have open "delay until recursion" levels, we should continue with the next one
        if (nextScanState === scan_state.NONE && availableRecursionDelayLevels.length) {
            nextScanState = scan_state.RECURSION;
            currentRecursionDelayLevel = availableRecursionDelayLevels.shift();
            logNextState('[WI] Open delayed recursion levels left. Preparing next delayed recursion level', currentRecursionDelayLevel, '. Still delayed:', availableRecursionDelayLevels);
        }

        // Final check if we should really continue scan, and extend the current WI recurse buffer
        const curScanState = scanState;
        scanState = nextScanState;
        if (scanState) {
            const text = successfulNewEntriesForRecursion
                .map(x => x.content).join('\n');
            if (text) {
                buffer.addRecurse(text);
                allActivatedText = (text + '\n' + allActivatedText);
            }
        } else {
            logNextState('[WI] Scan done. No new entries to prompt. Stopping.');
        }

        // Fire an event after each scan loop, so extensions can hook into the current scanning state
        const args = {
            state: {
                current: curScanState,
                next: scanState,
                loopCount: count,
            },
            new: {
                all: newEntries,
                successful: successfulNewEntries,
            },
            activated: {
                entries: allActivatedEntries,
                text: allActivatedText,
            },
            sortedEntries,
            recursionDelay: {
                availableLevels: availableRecursionDelayLevels,
                currentLevel: currentRecursionDelayLevel,
            },
            budget: {
                current: budget,
                overflowed: token_budget_overflowed,
            },
            timedEffects,
        };
        await eventSource.emit(event_types.WORLDINFO_SCAN_DONE, args);

        // Some fields are allowed to be changed by listeners, those will be handled here manually. They can be updated via changed the args from the listeners.
        // Any array provided directly can be modified by updating it's elements, adding or removing elements. This has to be done consistently.
        if (args.state.next !== scanState) {
            logNextState('[WI] Scan state changed from', scanState, 'to', args.state.next);
            scanState = args.state.next;
        }
        allActivatedText = args.activated.text;
        currentRecursionDelayLevel = args.recursionDelay.currentLevel;
        budget = args.budget.current;
        token_budget_overflowed = args.budget.overflowed;
    }

    console.debug('[WI] --- BUILDING PROMPT ---');

    // Forward-sorted list of entries for joining
    const WIBeforeEntries = [];
    const WIAfterEntries = [];
    const EMEntries = [];
    const ANTopEntries = [];
    const ANBottomEntries = [];
    const WIDepthEntries = [];
    /** @type {{[key: string]: string[]}} */
    const WIOutletEntries = {};

    // Appends from insertion order 999 to 1. Use unshift for this purpose
    // TODO (kingbri): Change to use WI Anchor positioning instead of separate top/bottom arrays
    [...allActivatedEntries.values()].sort(sortFn).forEach((entry) => {
        const regexDepth = entry.position === world_info_position.atDepth ? (entry.depth ?? DEFAULT_DEPTH) : null;
        const content = getRegexedString(entry.content, regex_placement.WORLD_INFO, { depth: regexDepth, isMarkdown: false, isPrompt: true });

        if (!content) {
            console.debug(`[WI] Entry ${entry.uid}`, 'skipped adding to prompt due to empty content', entry);
            return;
        }

        switch (entry.position) {
            case world_info_position.before:
                WIBeforeEntries.unshift(content);
                break;
            case world_info_position.after:
                WIAfterEntries.unshift(content);
                break;
            case world_info_position.EMTop:
                EMEntries.unshift(
                    { position: wi_anchor_position.before, content: content },
                );
                break;
            case world_info_position.EMBottom:
                EMEntries.unshift(
                    { position: wi_anchor_position.after, content: content },
                );
                break;
            case world_info_position.ANTop:
                ANTopEntries.unshift(content);
                break;
            case world_info_position.ANBottom:
                ANBottomEntries.unshift(content);
                break;
            case world_info_position.atDepth: {
                const existingDepthIndex = WIDepthEntries.findIndex((e) => e.depth === (entry.depth ?? DEFAULT_DEPTH) && e.role === (entry.role ?? extension_prompt_roles.SYSTEM));
                if (existingDepthIndex !== -1) {
                    WIDepthEntries[existingDepthIndex].entries.unshift(content);
                } else {
                    WIDepthEntries.push({
                        depth: entry.depth,
                        entries: [content],
                        role: entry.role ?? extension_prompt_roles.SYSTEM,
                    });
                }
                break;
            }
            case world_info_position.outlet: {
                if (!entry.outletName) {
                    console.warn(`[WI] Entry ${entry.uid} has position 'outlet' but no outlet name. Skipping.`);
                    break;
                }
                if (Array.isArray(WIOutletEntries[entry.outletName])) {
                    WIOutletEntries[entry.outletName].push(content);
                } else {
                    WIOutletEntries[entry.outletName] = [content];
                }
                break;
            }
            default:
                break;
        }
    });

    const worldInfoBefore = WIBeforeEntries.length ? WIBeforeEntries.join('\n') : '';
    const worldInfoAfter = WIAfterEntries.length ? WIAfterEntries.join('\n') : '';

    if (shouldWIAddPrompt) {
        const originalAN = context.extensionPrompts[NOTE_MODULE_NAME].value;
        const ANWithWI = `${ANTopEntries.join('\n')}\n${originalAN}\n${ANBottomEntries.join('\n')}`.replace(/(^\n)|(\n$)/g, '');
        context.setExtensionPrompt(NOTE_MODULE_NAME, ANWithWI, chat_metadata[metadata_keys.position], chat_metadata[metadata_keys.depth], extension_settings.note.allowWIScan, chat_metadata[metadata_keys.role]);
    }

    timedEffects.setTimedEffects(Array.from(allActivatedEntries.values()));
    buffer.resetExternalEffects();
    timedEffects.cleanUp();

    console.log(`[WI] ${isDryRun ? 'Hypothetically adding' : 'Adding'} ${allActivatedEntries.size} entries to prompt`, Array.from(allActivatedEntries.values()));
    console.debug(`[WI] --- DONE${isDryRun ? ' (DRY RUN)' : ''} ---`);

    return { worldInfoBefore, worldInfoAfter, EMEntries, WIDepthEntries, ANBeforeEntries: ANTopEntries, ANAfterEntries: ANBottomEntries, outletEntries: WIOutletEntries, allActivatedEntries: new Set(allActivatedEntries.values()) };
}

/**
 * Only leaves entries with the highest key matching score in each group.
 * @param {Record<string, WIScanEntry[]>} groups The groups to filter
 * @param {WorldInfoBuffer} buffer The buffer to use for scoring
 * @param {(entry: WIScanEntry) => void} removeEntry The function to remove an entry
 * @param {number} scanState The current scan state
 * @param {Map<string, boolean>} hasStickyMap The sticky entries map
 */
function filterGroupsByScoring(groups, buffer, removeEntry, scanState, hasStickyMap) {
    for (const [key, group] of Object.entries(groups)) {
        // Group scoring is disabled both globally and for the group entries
        if (!world_info_use_group_scoring && !group.some(x => x.useGroupScoring)) {
            console.debug(`[WI] Skipping group scoring for group '${key}'`);
            continue;
        }

        // If the group has any sticky entries, the rest are already removed by the timed effects filter
        const hasAnySticky = hasStickyMap.get(key);
        if (hasAnySticky) {
            console.debug(`[WI] Skipping group scoring check, group '${key}' has sticky entries`);
            continue;
        }

        const scores = group.map(entry => buffer.getScore(entry, scanState));
        const maxScore = Math.max(...scores);
        console.debug(`[WI] Group '${key}' max score:`, maxScore);
        //console.table(group.map((entry, i) => ({ uid: entry.uid, key: JSON.stringify(entry.key), score: scores[i] })));

        for (let i = 0; i < group.length; i++) {
            const isScored = group[i].useGroupScoring ?? world_info_use_group_scoring;

            if (!isScored) {
                continue;
            }

            if (scores[i] < maxScore) {
                console.debug(`[WI] Entry ${group[i].uid}`, `removed as score loser from inclusion group '${key}'`, group[i]);
                removeEntry(group[i]);
                group.splice(i, 1);
                scores.splice(i, 1);
                i--;
            }
        }
    }
}

/**
 * Removes entries on cooldown and forces sticky entries as winners.
 * @param {Record<string, WIScanEntry[]>} groups The groups to filter
 * @param {WorldInfoTimedEffects} timedEffects The timed effects to use
 * @param {(entry: WIScanEntry) => void} removeEntry The function to remove an entry
 * @returns {Map<string, boolean>} If any sticky entries were found
 */
function filterGroupsByTimedEffects(groups, timedEffects, removeEntry) {
    /** @type {Map<string, boolean>} */
    const hasStickyMap = new Map();

    for (const [key, group] of Object.entries(groups)) {
        hasStickyMap.set(key, false);

        // If the group has any sticky entries, leave only the sticky entries
        const stickyEntries = group.filter(x => timedEffects.isEffectActive('sticky', x));
        if (stickyEntries.length) {
            for (const entry of group) {
                if (stickyEntries.includes(entry)) {
                    continue;
                }

                console.debug(`[WI] Entry ${entry.uid}`, `removed as a non-sticky loser from inclusion group '${key}'`, entry);
                removeEntry(entry);
            }

            hasStickyMap.set(key, true);
        }

        // It should not be possible for an entry on cooldown/delay to event get into the grouping phase but @Wolfsblvt told me to leave it here.
        const cooldownEntries = group.filter(x => timedEffects.isEffectActive('cooldown', x));
        if (cooldownEntries.length) {
            console.debug(`[WI] Inclusion group '${key}' has entries on cooldown. They will be removed.`, cooldownEntries);
            for (const entry of cooldownEntries) {
                removeEntry(entry);
            }
        }

        const delayEntries = group.filter(x => timedEffects.isEffectActive('delay', x));
        if (delayEntries.length) {
            console.debug(`[WI] Inclusion group '${key}' has entries with delay. They will be removed.`, delayEntries);
            for (const entry of delayEntries) {
                removeEntry(entry);
            }
        }
    }

    return hasStickyMap;
}

/**
 * Filters entries by inclusion groups.
 * @param {object[]} newEntries Entries activated on current recursion level
 * @param {Map<string, object>} allActivatedEntries Map of all activated entries
 * @param {WorldInfoBuffer} buffer The buffer to use for scanning
 * @param {number} scanState The current scan state
 * @param {WorldInfoTimedEffects} timedEffects The timed effects currently active
 */
function filterByInclusionGroups(newEntries, allActivatedEntries, buffer, scanState, timedEffects) {
    console.debug('[WI] --- INCLUSION GROUP CHECKS ---');

    const grouped = newEntries.filter(x => x.group).reduce((acc, item) => {
        item.group.split(/,\s*/).filter(x => x).forEach(group => {
            if (!acc[group]) {
                acc[group] = [];
            }
            acc[group].push(item);
        });
        return acc;
    }, {});

    if (Object.keys(grouped).length === 0) {
        console.debug('[WI] No inclusion groups found');
        return;
    }

    const removeEntry = (entry) => newEntries.splice(newEntries.indexOf(entry), 1);
    function removeAllBut(group, chosen, logging = true) {
        for (const entry of group) {
            if (entry === chosen) {
                continue;
            }

            if (logging) console.debug(`[WI] Entry ${entry.uid}`, `removed as loser from inclusion group '${entry.group}'`, entry);
            removeEntry(entry);
        }
    }

    const hasStickyMap = filterGroupsByTimedEffects(grouped, timedEffects, removeEntry);
    filterGroupsByScoring(grouped, buffer, removeEntry, scanState, hasStickyMap);

    for (const [key, group] of Object.entries(grouped)) {
        console.debug(`[WI] Checking inclusion group '${key}' with ${group.length} entries`, group);

        // If the group has any sticky entries, the rest are already removed by the timed effects filter
        const hasAnySticky = hasStickyMap.get(key);
        if (hasAnySticky) {
            console.debug(`[WI] Skipping inclusion group check, group '${key}' has sticky entries`);
            continue;
        }

        if (Array.from(allActivatedEntries.values()).some(x => x.group === key)) {
            console.debug(`[WI] Skipping inclusion group check, group '${key}' was already activated`);
            // We need to forcefully deactivate all other entries in the group
            removeAllBut(group, null, false);
            continue;
        }

        if (!Array.isArray(group) || group.length <= 1) {
            console.debug('[WI] Skipping inclusion group check, only one entry');
            continue;
        }

        // Check for group prio
        const prios = group.filter(x => x.groupOverride).sort(sortFn);
        if (prios.length) {
            console.debug(`[WI] Entry ${prios[0].uid}`, `activated as prio winner from inclusion group '${key}'`, prios[0]);
            removeAllBut(group, prios[0]);
            continue;
        }

        // Do weighted random using entry's weight
        const totalWeight = group.reduce((acc, item) => acc + (item.groupWeight ?? DEFAULT_WEIGHT), 0);
        const rollValue = Math.random() * totalWeight;
        let currentWeight = 0;
        let winner = null;

        for (const entry of group) {
            currentWeight += (entry.groupWeight ?? DEFAULT_WEIGHT);

            if (rollValue <= currentWeight) {
                console.debug(`[WI] Entry ${entry.uid}`, `activated as roll winner from inclusion group '${key}'`, entry);
                winner = entry;
                break;
            }
        }

        if (!winner) {
            console.debug(`[WI] Failed to activate inclusion group '${key}', no winner found`);
            continue;
        }

        // Remove every group item from newEntries but the winner
        removeAllBut(group, winner);
    }
}


return {scan:checkWorldInfo};
}
