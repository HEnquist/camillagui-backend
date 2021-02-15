import {defaultConfig, defaultFilter, filterNamesOf, newFilterName, removeFilter, renameFilter} from "./config";

test('newFilterName ', () => {
    const config = defaultConfig()
    const filters = config.filters
    expect(newFilterName(filters)).toBe('New Filter 1')
    filters['New Filter 1'] = defaultFilter()
    expect(newFilterName(filters)).toBe('New Filter 2')
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
    expect(filterNamesOf(config)).toEqual([])
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
    expect(filterNamesOf(config)).toEqual(['renamed'])
    expect(config.pipeline[0].names).toEqual(['renamed', 'filter1', 'renamed', 'filter2', 'renamed'])
    expect(config.pipeline[1].names).toEqual(['filter3', 'renamed', 'filter4'])
})

test('renameFilter throws on name collision', () => {
    const config = defaultConfig()
    config.filters['to be renamed'] = defaultFilter()
    config.filters['collision'] = defaultFilter()
    expect(() => renameFilter(config, 'to be renamed', 'collision')).toThrow("Filter 'collision' already exists")
})