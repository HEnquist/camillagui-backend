import {
    defaultConfig,
    defaultFilter, defaultMapping, defaultMixer,
    defaultSource,
    sortedFilterNamesOf, mixerNamesOf,
    newFilterName,
    removeFilter, removeMixer,
    renameFilter, renameMixer
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
        names: ['to be removed', 'filter1', 'to be removed', 'filter2', 'to be removed']
    }
    config.pipeline[1] = {
        type: 'Filter',
        channel: 1,
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
        names: ['to be renamed', 'filter1', 'to be renamed', 'filter2', 'to be renamed']
    }
    config.pipeline[1] = {
        type: 'Filter',
        channel: 1,
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
    config.pipeline[0] = {type: 'Mixer', name: 'to be removed'}
    config.pipeline[1] = {type: 'Mixer', name: 'Mixer1'}
    removeMixer(config, 'to be removed')
    expect(mixerNamesOf(config)).toEqual(['Mixer1'])
    expect(config.pipeline[0].name).toEqual('Mixer1')
})

test('renameMixer', () => {
    const config = defaultConfig()
    config.mixers['to be renamed'] = defaultMixer()
    config.pipeline[0] = {type: 'Mixer', name: 'Mixer1'}
    config.pipeline[1] = {type: 'Mixer', name: 'to be renamed'}
    config.pipeline[2] = {type: 'Mixer', name: 'Mixer2'}
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