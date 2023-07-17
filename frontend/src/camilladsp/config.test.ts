import {
    defaultConfig,
    defaultFilter, defaultMapping, defaultMixer,
    defaultSource,
    sortedFilterNamesOf, mixerNamesOf,
    newFilterName,
    removeFilter, removeMixer,
    renameFilter, renameMixer, maxChannelCount
} from "./config"

test('newFilterName ', () => {
    const config = defaultConfig()
    const filters = config.filters
    expect(newFilterName(filters)).toBe('Unnamed Filter 1')
    filters['Unnamed Filter 1'] = defaultFilter()
    expect(newFilterName(filters)).toBe('Unnamed Filter 2')
})

test('removeFilter', () => {
    const config = defaultConfig()
    config.filters['to be removed'] = defaultFilter()
    config.pipeline[0] = {
        type: 'Filter',
        channel: 0,
        description: null,
        bypassed: null,
        names: ['to be removed', 'filter1', 'to be removed', 'filter2', 'to be removed']
    }
    config.pipeline[1] = {
        type: 'Filter',
        channel: 1,
        description: null,
        bypassed: null,
        names: ['filter3', 'to be removed', 'filter4']
    }
    removeFilter(config, 'to be removed')
    expect(sortedFilterNamesOf(config, "Name", false)).toEqual([])
    expect(config.pipeline[0].names).toEqual(['filter1', 'filter2'])
    expect(config.pipeline[1].names).toEqual(['filter3', 'filter4'])
})

test('renameFilter', () => {
    const config = defaultConfig()
    config.filters['to be renamed'] = defaultFilter()
    config.pipeline[0] = {
        type: 'Filter',
        channel: 0,
        description: null,
        bypassed: null,
        names: ['to be renamed', 'filter1', 'to be renamed', 'filter2', 'to be renamed']
    }
    config.pipeline[1] = {
        type: 'Filter',
        channel: 1,
        description: null,
        bypassed: null,
        names: ['filter3', 'to be renamed', 'filter4']
    }
    renameFilter(config, 'to be renamed', 'renamed')
    expect(sortedFilterNamesOf(config, "Name", false)).toEqual(['renamed'])
    expect(config.pipeline[0].names).toEqual(['renamed', 'filter1', 'renamed', 'filter2', 'renamed'])
    expect(config.pipeline[1].names).toEqual(['filter3', 'renamed', 'filter4'])
})

test('renameFilter throws on name collision', () => {
    const config = defaultConfig()
    config.filters['to be renamed'] = defaultFilter()
    config.filters['collision'] = defaultFilter()
    expect(() => renameFilter(config, 'to be renamed', 'collision')).toThrow("Filter 'collision' already exists")
})

test('defaultMapping counts destination channel up until out channel count', () => {
    const mapping = defaultMapping(1, [])
    expect(mapping.dest).toBe(0)
    expect(() => defaultMapping(1, [mapping]).dest).toThrow('Cannot add more than 1 (out) mappings')
    expect(defaultMapping(2, [mapping]).dest).toBe(1)
    expect(() => defaultMapping(2, [mapping, mapping]).dest).toThrow('Cannot add more than 2 (out) mappings')
})

test('defaultSource counts input channel up until in channel count', () => {
    const source = defaultSource(1, [])
    expect(source.channel).toBe(0)
    expect(defaultSource(1, [source]).channel).toBe(0)
    expect(defaultSource(2, [source]).channel).toBe(1)
    expect(defaultSource(2, [source, source]).channel).toBe(0)
})

test('removeMixer', () => {
    const config = defaultConfig()
    config.mixers['to be removed'] = defaultMixer()
    config.mixers['Mixer1'] = defaultMixer()
    config.pipeline[0] = {type: 'Mixer', name: 'to be removed', description: null, bypassed: null}
    config.pipeline[1] = {type: 'Mixer', name: 'Mixer1', description: null, bypassed: null}
    removeMixer(config, 'to be removed')
    expect(mixerNamesOf(config)).toEqual(['Mixer1'])
    expect(config.pipeline[0].name).toEqual('Mixer1')
})

test('renameMixer', () => {
    const config = defaultConfig()
    config.mixers['to be renamed'] = defaultMixer()
    config.pipeline[0] = {type: 'Mixer', name: 'Mixer1', description: null, bypassed: null}
    config.pipeline[1] = {type: 'Mixer', name: 'to be renamed', description: null, bypassed: null}
    config.pipeline[2] = {type: 'Mixer', name: 'Mixer2', description: null, bypassed: null}
    renameMixer(config, 'to be renamed', 'renamed')
    expect(mixerNamesOf(config)).toEqual(['renamed'])
    expect(config.pipeline[0].name).toEqual('Mixer1')
    expect(config.pipeline[1].name).toEqual('renamed')
    expect(config.pipeline[2].name).toEqual('Mixer2')
})

test('renameMixer throws on name collision', () => {
    const config = defaultConfig()
    config.mixers['to be renamed'] = defaultMixer()
    config.mixers['collision'] = defaultMixer()
    expect(() => renameMixer(config, 'to be renamed', 'collision')).toThrow("Mixer 'collision' already exists")
})

test('maxChannelCount', () => {
    const config = defaultConfig()
    config.devices.capture.channels = 1
    config.devices.playback.channels = 9999
    config.mixers.mixer1 = defaultMixer()
    config.mixers.mixer1.channels.out = 2
    config.mixers.mixer2 = defaultMixer()
    config.mixers.mixer2.channels.out = 3
    config.pipeline = [
        { type: 'Mixer', name: 'mixer1', description: null, bypassed: null },
        { type: 'Processor', name: '', description: null, bypassed: null },
        { type: 'Filter', channel: 0, names: [], description: null, bypassed: null },
        { type: 'Mixer', name: 'mixer2', description: null, bypassed: null },
        { type: 'Mixer', name: '', description: null, bypassed: null }
    ]
    expect(maxChannelCount(config, 0)).toBe(1)
    expect(maxChannelCount(config, 1)).toBe(2)
    expect(maxChannelCount(config, 2)).toBe(2)
    expect(maxChannelCount(config, 3)).toBe(2)
    expect(maxChannelCount(config, 4)).toBe(3)
    expect(maxChannelCount(config, 5)).toBe(3)
})