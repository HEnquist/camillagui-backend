import React from "react"
import cloneDeep from "lodash/cloneDeep"
import "./index.css"
import { mdiAlertCircle, mdiChartBellCurveCumulative, mdiFileSearch, mdiUpload, mdiArrowCollapse, mdiArrowExpand } from '@mdi/js'
import {
  Config,
  defaultFilter,
  DefaultFilterParameters,
  Filter,
  newFilterName,
  removeFilter,
  renameFilter,
  sortedFilterNamesOf,
  FilterSortKeys,
  VolumeFaders,
  LoudnessFaders,
} from "./camilladsp/config"
import {
  AddButton,
  BoolOption,
  Box,
  Button,
  delayedExecutor,
  DeleteButton,
  EnumInput,
  EnumOption,
  ErrorMessage,
  FloatInput,
  FloatListOption,
  FloatOption,
  IntOption,
  FileSelectPopup,
  MdiButton,
  OptionalBoolOption,
  OptionalTextOption,
  OptionalFloatOption,
  OptionalIntOption,
  ParsedInput,
  TextOption,
  UploadButton
} from "./utilities/ui-components"
import { ErrorsForPath, errorsForSubpath } from "./utilities/errors"
import { modifiedCopyOf, Update } from "./utilities/common"
import { isEqual } from "lodash"
import { Chart, ChartData } from "./utilities/chart"
import {doUpload, loadFiles, FileInfo} from "./utilities/files"

// TODO update conv parameters
// TODO optional bool in general notch
// TODO update volume/loudness parameters


export class FiltersTab extends React.Component<
  {
    config: Config
    samplerate: number
    channels: Promise<number>
    coeffDir: string
    updateConfig: (update: Update<Config>) => void
    errors: ErrorsForPath
  },
  {
    filterKeys: { [name: string]: number }
    availableCoeffFiles: FileInfo[]
    sortBy: string
    sortReverse: boolean
  }
> {
  constructor(props: any) {
    super(props)
    this.filterNames = this.filterNames.bind(this)
    this.changeSortBy = this.changeSortBy.bind(this)
    this.changeSortOrder = this.changeSortOrder.bind(this)
    this.addFilter = this.addFilter.bind(this)
    this.removeFilter = this.removeFilter.bind(this)
    this.renameFilter = this.renameFilter.bind(this)
    this.isFreeFilterName = this.isFreeFilterName.bind(this)
    this.updateFilter = this.updateFilter.bind(this)
    this.updateAvailableCoeffFiles = this.updateAvailableCoeffFiles.bind(this)
    this.state = {
      filterKeys: {},
      availableCoeffFiles: [],
      sortBy: "Name",
      sortReverse: false
    }
    this.filterNames().forEach((name, i) => this.state.filterKeys[name] = i)
    this.updateAvailableCoeffFiles()
  }

  //private timer = delayedExecutor(2000)

  private filterNames(): string[] {
    return sortedFilterNamesOf(this.props.config.filters, this.state.sortBy, this.state.sortReverse)
  }

  private changeSortBy(key: string) {
    this.setState({ sortBy: key })
  }

  private changeSortOrder(reverse: boolean) {
    this.setState({ sortReverse: reverse })
  }

  private addFilter() {
    this.props.updateConfig(config => {
      const newFilter = newFilterName(config.filters)
      this.setState(oldState =>
        modifiedCopyOf(oldState, newState =>
          newState.filterKeys[newFilter] = 1 + Math.max(0, ...Object.values(oldState.filterKeys))
        )
      )
      if (config.filters === null) {
        config.filters = {}
      }
      config.filters[newFilter] = defaultFilter()
    })
  }

  private removeFilter(name: string) {
    this.props.updateConfig(config => {
      removeFilter(config, name)
      this.setState(oldState =>
        modifiedCopyOf(oldState, newState => delete newState.filterKeys[name]))
    })
  }

  private renameFilter(oldName: string, newName: string) {
    if (this.isFreeFilterName(newName))
      this.props.updateConfig(config => {
        this.setState(oldState =>
          modifiedCopyOf(oldState, newState => {
            newState.filterKeys[newName] = newState.filterKeys[oldName]
            delete newState.filterKeys[oldName]
          }))
        renameFilter(config, oldName, newName)
      })
  }

  private isFreeFilterName(name: string): boolean {
    return !this.filterNames().includes(name)
  }

  private updateFilter(name: string, update: Update<Filter>) {
    this.props.updateConfig(config => {
      if (!config.filters) {
        config.filters = {}
      }
      update(config.filters[name])
    })
  }

  private updateAvailableCoeffFiles() {
    loadFiles("coeff")
      .then(
        files => this.setState({ availableCoeffFiles: files }),
        error => console.log("Could not load stored coeffs", error)
      )
  }

  render() {
    let { config, errors } = this.props
    return <div>
      <div className="horizontally-spaced-content" style={{ width: '700px' }}>
        <EnumOption
          value={this.state.sortBy}
          options={FilterSortKeys}
          desc="Sort filters by"
          tooltip="Property used to sort filters"
          onChange={this.changeSortBy} />
        <BoolOption
          value={this.state.sortReverse}
          desc="Reverse order"
          tooltip="Reverse display order"
          onChange={this.changeSortOrder} />
      </div>
      <div className="tabpanel-with-header" style={{ width: '100%'}}>
        <ErrorMessage message={errors({ path: [] })} />
        {this.filterNames()
          .map(name =>
            <FilterView
              key={this.state.filterKeys[name]}
              name={name}
              // @ts-ignore
              filter={config.filters[name]}
              errors={errorsForSubpath(errors, name)}
              availableCoeffFiles={this.state.availableCoeffFiles}
              updateFilter={update => this.updateFilter(name, update)}
              rename={newName => this.renameFilter(name, newName)}
              isFreeFilterName={this.isFreeFilterName}
              remove={() => this.removeFilter(name)}
              updateAvailableCoeffFiles={this.updateAvailableCoeffFiles}
              coeffDir={this.props.coeffDir}
              samplerate={this.props.samplerate}
              channels={this.props.channels}
            />
          )}
        <AddButton tooltip="Add a new filter" onClick={this.addFilter} />
      </div></div>
  }
}

function isConvolutionFileFilter(filter: Filter): boolean {
  return filter.type === 'Conv' && (filter.parameters.type === 'Raw' || filter.parameters.type === 'Wav')
}

function isGraphicEqualizer(filter: Filter): boolean {
  return filter.type === 'BiquadCombo' && filter.parameters.type === 'GraphicEqualizer'
}

interface FilterDefaults {
  type?: string
  format?: string
  skip_bytes_lines?: number
  read_bytes_lines?: number
  errors?: string[]
}

interface FilterViewProps {
  name: string
  filter: Filter
  errors: ErrorsForPath
  availableCoeffFiles: FileInfo[]
  updateFilter: (update: Update<Filter>) => void
  rename: (newName: string) => void
  isFreeFilterName: (name: string) => boolean
  remove: () => void
  updateAvailableCoeffFiles: () => void
  coeffDir: string
  samplerate: number
  channels: Promise<number>
}

interface FilterViewState {
  uploadState?: { success: true } | { success: false, message: string }
  filterFilePopupOpen: boolean
  showFilterPlot: boolean
  expandPlot: boolean
  data?: ChartData
  filterDefaults: FilterDefaults
  showDefaults: boolean
  channels: number
  plot_at_volume: number
}

class FilterView extends React.Component<FilterViewProps, FilterViewState> {

  constructor(props: any) {
    super(props)
    this.uploadCoeffs = this.uploadCoeffs.bind(this)
    this.pickFilterFile = this.pickFilterFile.bind(this)
    this.updateDefaults = this.updateDefaults.bind(this)
    this.updateFilterParamsWithDefaults = this.updateFilterParamsWithDefaults.bind(this)
    this.toggleFilterPlot = this.toggleFilterPlot.bind(this)
    this.toggleExpand = this.toggleExpand.bind(this)
    this.setPlotVolume = this.setPlotVolume.bind(this)
    this.plotFilterInitially = this.plotFilterInitially.bind(this)
    this.plotFilter = this.plotFilter.bind(this)

    this.state = {
      filterFilePopupOpen: false,
      showFilterPlot: false,
      expandPlot: false,
      showDefaults: false,
      filterDefaults: {},
      channels: 2,
      plot_at_volume: 0.0
    }
    if (isConvolutionFileFilter(this.props.filter))
      this.updateDefaults(this.props.filter.parameters.filename)
    this.plotFilter()
  }

  private timer = delayedExecutor(500)

  private uploadCoeffs(files: FileList) {
    doUpload('coeff', files,
      fileNames => {
        this.setState({ uploadState: { success: true } })
        const { updateAvailableCoeffFiles } = this.props
        this.pickFilterFile(fileNames[0])
        updateAvailableCoeffFiles()
      },
      message => this.setState({ uploadState: { success: false, message: message } })
    )
  }

  private pickFilterFile(selectedFilename: string) {
    const { coeffDir, updateFilter } = this.props
    updateFilter(coeffFileNameUpdate(coeffDir, selectedFilename))
    this.updateDefaults(coeffFilePath(coeffDir, selectedFilename), true)
  }

  private updateDefaults(filename: string, updateFilter: boolean = false) {
    const filter = this.props.filter
    if (isConvolutionFileFilter(filter)) {
      fetch(`/api/defaultsforcoeffs?file=${encodeURIComponent(filename)}`)
        .then(response =>
          response.json().then(json => {
            const defaults = json as FilterDefaults
            this.setState({ filterDefaults: defaults, showDefaults: false })
            if (updateFilter)
              this.updateFilterParamsWithDefaults(defaults)
          })
        )
    }
  }

  private updateFilterParamsWithDefaults(defaults: FilterDefaults) {
    this.props.updateFilter(filter => {
      const subtype = defaults.type ? defaults.type : filter.parameters.type
      const guiDefaults = DefaultFilterParameters[filter.type][subtype]
      const channel = filter.parameters.channel
      filter.parameters = {
        ...guiDefaults,
        ...defaults,
        filename: filter.parameters.filename
      }
      if (channel) filter.parameters.channel = channel
    })
  }

  componentDidMount() {
    this.props.channels.then(ch => {
      console.log('channels', ch)
      this.setState({ channels: ch })
    })
  }

  componentDidUpdate(prevProps: Readonly<FilterViewProps>, prevState: Readonly<FilterViewState>, snapshot?: any) {
    if (this.state.showFilterPlot) {
      const prevFilter = prevProps.filter
      const currentFilter = this.props.filter
      if (prevFilter.type !== currentFilter.type || !isEqual(prevFilter.parameters, currentFilter.parameters) || this.state.plot_at_volume !== prevState.plot_at_volume)
        this.timer(() => this.plotFilter())
    }
  }

  private toggleFilterPlot() {
    const showFilterPlot = !this.state.showFilterPlot
    this.setState({ showFilterPlot })
    if (showFilterPlot)
      this.plotFilter()
    else
      this.setState({ data: undefined })
  }

  private setPlotVolume(volume: number) {
    this.setState({ plot_at_volume: volume })
  }

  private toggleExpand() {
    const expandPlot = !this.state.expandPlot
    this.setState({ expandPlot })
  }

  private plotFilterInitially(file: string) {
    const options = this.state.data!!.options
    const current = options.length === 0 ? undefined : options.filter(o => o.name === file)[0]
    this.plotFilter(current?.samplerate, current?.channels)
  }



  private plotFilter(samplerate?: number, channels?: number) {
    fetch("/api/evalfilter", {
      method: "POST",
      headers: { "Content-Type": "application/json", },
      body: JSON.stringify({
        name: this.props.name,
        config: this.props.filter,
        samplerate: samplerate || this.props.samplerate,
        channels: channels || this.state.channels,
        volume: this.state.plot_at_volume
      }),
    }).then(
      result => result.json()
        .then(data => {
          if (this.state.showFilterPlot)
            this.setState({ data: data as ChartData })
        },
        error => console.log("JSON parse failed", error)
      ),
      error => console.log("api call failed", error)
    )
  }

  render() {
    const { name, filter } = this.props
    const uploadState = this.state.uploadState
    const isValidFilterName = (newName: string) =>
      name === newName || (newName.trim().length > 0 && this.props.isFreeFilterName(newName))
    let uploadIcon: { icon: string, className?: string, errorMessage?: string } =
      { icon: mdiUpload }
    if (uploadState !== undefined && !uploadState.success)
      uploadIcon = { icon: mdiAlertCircle, className: 'error-text', errorMessage: uploadState.message }
    return <Box style={{width: '700px' }} title={
      <ParsedInput
        style={{ width: '300px' }}
        value={name}
        asString={x => x}
        parseValue={newName => isValidFilterName(newName) ? newName : undefined}
        tooltip="Filter name, must be unique"
        onChange={newName => this.props.rename(newName)}
        immediate={false}
      />
    }>
      <div style={{ display: 'flex', flexDirection: 'row', width: '670px' }}>
        <div
          className="vertically-spaced-content"
          style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <MdiButton
            icon={mdiChartBellCurveCumulative}
            tooltip="Plot frequency response of this filter"
            onClick={this.toggleFilterPlot} />
          {isConvolutionFileFilter(filter) &&
            <MdiButton
              icon={mdiFileSearch}
              tooltip="Pick filter file"
              onClick={() => this.setState({ filterFilePopupOpen: true })} />
          }
          <DeleteButton tooltip={"Delete this filter"} onClick={this.props.remove} />
        </div>
        <FilterParams
          filter={this.props.filter}
          errors={this.props.errors}
          updateFilter={this.props.updateFilter}
          availableCoeffFiles={this.props.availableCoeffFiles}
          coeffDir={this.props.coeffDir}
          filterDefaults={this.state.filterDefaults}
          showDefaults={this.state.showDefaults}
          setShowDefaults={() => this.setState({ showDefaults: true })} />
      </div>


      <FileSelectPopup
        key="filter select popup"
        open={this.state.filterFilePopupOpen}
        header={
          <div style={{ margin: '5px', display: 'flex', flexDirection: 'column'}}>
            <span>Select a file containing filter coefficients.</span>
            <span>For Raw filters, only single channel files are supported.</span>
            <UploadButton
              icon={uploadIcon.icon}
              className={uploadIcon.className}
              tooltip={uploadIcon.errorMessage ? uploadIcon.errorMessage : "Upload filter files"}
              upload={this.uploadCoeffs}
              multiple={true} />
          </div>
        }
        files={this.props.availableCoeffFiles}
        onClose={() => this.setState({ filterFilePopupOpen: false })}
        onSelect={this.pickFilterFile}
      />
      {this.state.showFilterPlot && this.state.data ?
        <div style={{ width: this.state.expandPlot && this.state.showFilterPlot ? '1100px' : '670px' }}>
          <Chart data={this.state.data} onChange={this.plotFilterInitially} />
          <div style={{ display: 'inline-flex', flexDirection: 'row'}}>
          <MdiButton
            icon={this.state.expandPlot ? mdiArrowCollapse : mdiArrowExpand}
            tooltip={this.state.expandPlot ? "Collapse plot" : "Expand plot"}
            onClick={this.toggleExpand} />
          {this.props.filter.type === "Loudness" ?
            <div style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center'}}>
              <input
                type="range"
                min={-500}
                max={200}
                value={this.state.plot_at_volume * 10.0}
                onBlur={e => this.setPlotVolume(e.target.valueAsNumber / 10.0)}
                onChange={e => this.setPlotVolume(e.target.valueAsNumber / 10.0)}
                data-tooltip-html="Volume setting to evaluate filter at"
                data-tooltip-id="main-tooltip"
              />
              <div>{this.state.plot_at_volume} dB</div>
            </div>
          : null}
          </div></div>
        : null}
    </Box>
  }
}

function coeffFileNameFromPath(coeffDir: string, absolutePath: string): string {
  return absolutePath.replace(coeffDir, '')
}

function coeffFilePath(coeffDir: string, filename: string) {
  return coeffDir + filename
}

function coeffFileNameUpdate(coeffDir: string, filename: string): Update<Filter> {
  return filter => filter.parameters.filename = coeffFilePath(coeffDir, filename)
}

const hiddenParameters = ['skip_bytes_lines', 'read_bytes_lines']

class FilterParams extends React.Component<{
  filter: Filter
  errors: ErrorsForPath
  updateFilter: (update: Update<Filter>) => void
  availableCoeffFiles: FileInfo[]
  coeffDir: string
  filterDefaults: FilterDefaults
  setShowDefaults: () => void
  showDefaults: boolean
}, unknown> {
  constructor(props: any) {
    super(props)
    this.onDescChange = this.onDescChange.bind(this)
    this.onTypeChange = this.onTypeChange.bind(this)
    this.onSubtypeChange = this.onSubtypeChange.bind(this)
    this.renderFilterParams = this.renderFilterParams.bind(this)
    this.hasHiddenDefaultValue = this.hasHiddenDefaultValue.bind(this)
    this.isHiddenDefaultValue = this.isHiddenDefaultValue.bind(this)
    this.filenameField = this.filenameField.bind(this)
    this.QorBandwithOrSlope = this.QorBandwithOrSlope.bind(this)
    this.addBand = this.addBand.bind(this)
    this.removeBand = this.removeBand.bind(this)
    this.adjustBand = this.adjustBand.bind(this)
  }

  //private timer = delayedExecutor(1000)

  private onDescChange(desc: string | null) {
    this.props.updateFilter(filter => {
      filter.description = desc
    })
  }

  private onTypeChange(type: string) {
    this.props.updateFilter(filter => {
      filter.type = type
      const subtypeDefaults = DefaultFilterParameters[type]
      const firstSubtypeOrDefault = Object.keys(subtypeDefaults)[0]
      filter.parameters = cloneDeep(subtypeDefaults[firstSubtypeOrDefault])
    })
  }

  private onSubtypeChange(subtype: string) {
    this.props.updateFilter(filter => {
      const oldFilename = isConvolutionFileFilter(filter) ? filter.parameters.filename : undefined
      const oldParameters = filter.parameters
      filter.parameters = cloneDeep(DefaultFilterParameters[filter.type][subtype])
      if (oldFilename && isConvolutionFileFilter(filter))
        filter.parameters.filename = oldFilename //keep filename, if switch is between Raw and Wav
        for (const par in oldParameters) {
          // Copy the value of any parameter common to old and new, except "type"
          if (filter.parameters.hasOwnProperty(par) && par !== "type") {
            filter.parameters[par] = oldParameters[par]
          }
      }
    }
    )
  }

  private eqBandFrequency(fmin: number, fmax: number, nbr_bands: number, band: number) {
    let f_min_log = Math.log(fmin) / Math.log(2)
    let f_max_log = Math.log(fmax) / Math.log(2)
    let bw = (f_max_log - f_min_log) / nbr_bands
    let freq_log = f_min_log + (band + 0.5) * bw
    let freq = Math.pow(2.0, freq_log)
    if (freq < 10) {
      return freq.toFixed(1)
    }
    if (freq < 1000) {
      return freq.toFixed(0)
    }
    if (freq < 10000) {
      return (freq / 1000).toFixed(1) + 'k'
    }
    return (freq / 1000).toFixed(0) + 'k'
  }

  private addBand() {
    this.props.updateFilter(filter => {
      filter.parameters.gains.push(0.0)
    })
  }

  private removeBand() {
    this.props.updateFilter(filter => {
      filter.parameters.gains.pop()
    })
  }

  private adjustBand(band: number, value: string) {
    const val = parseFloat(value)
    this.props.updateFilter(filter => {
      filter.parameters.gains[band] = val
    })
  }

  render() {
    const { filter, errors } = this.props
    const defaults = DefaultFilterParameters[filter.type]
    const subtypeOptions = defaults ? Object.keys(defaults) : []
    return <div style={{ width: '100%', textAlign: 'right' }}>
      <ErrorMessage message={errors({ path: [] })} />
      <EnumOption
        value={filter.type}
        error={errors({ path: ['type'] })}
        options={Object.keys(DefaultFilterParameters)}
        desc="type"
        tooltip="Filter type"
        onChange={this.onTypeChange} />
      {subtypeOptions[0] !== 'Default' &&
        <EnumOption
          value={filter.parameters.type}
          error={errors({ path: ['parameters', 'type'] })}
          options={subtypeOptions}
          desc="subtype"
          tooltip="Filter subtype"
          onChange={this.onSubtypeChange} />
      }
      <ErrorMessage message={errors({ path: ['parameters'] })} />
      {this.renderFilterParams(filter.parameters, errorsForSubpath(errors, 'parameters'))}
      {isConvolutionFileFilter(this.props.filter) && !this.props.showDefaults && (this.hasHiddenDefaultValue()) &&
        <Button text="..." onClick={() => this.props.setShowDefaults()} />
      }
      <OptionalTextOption
        placeholder="none"
        value={filter.description}
        desc="description"
        tooltip="Filter description"
        onChange={this.onDescChange} />
      {isGraphicEqualizer(filter) &&
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center' }}>
          {filter.parameters.gains.map((gain: number, index: number, gains: [number]) =>
            <div key={"eqslider" + index} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center' }}>
                {gain.toFixed(1)}
              </div>
              <div className="eqslider-wrapper">
                <input className="eqslider" type="range" min="-10" max="10" value={gain} step="0.1" onChange={e => this.adjustBand(index, e.target.value)} onDoubleClick={e => this.adjustBand(index, "0.0")} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center' }}>
                {this.eqBandFrequency(filter.parameters.freq_min, filter.parameters.freq_max, gains.length, index)}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <AddButton tooltip="Add one band" onClick={this.addBand} />
            <DeleteButton tooltip="Remove one band" onClick={this.removeBand} />
          </div>
        </div>
      }
    </div>
  }

  private renderFilterParams(parameters: { [p: string]: any }, errors: ErrorsForPath) {
    return Object.keys(parameters).map(parameter => {
      if (parameter === 'type') // 'type' is already rendered by parent component
        return null
      const info = this.parameterInfos[parameter]
      if (info === undefined) {
        console.log(`Rendering for filter parameter '${parameter}' is not implemented`)
        return null
      }
      const commonProps = {
        key: parameter,
        value: parameters[parameter],
        error: errors({ path: [parameter] }),
        desc: info.desc,
        tooltip: info.tooltip,
        //onChange: (value: any) => this.timer(() => this.props.updateFilter(filter => filter.parameters[parameter] = value))
        onChange: (value: any) => this.props.updateFilter(filter => filter.parameters[parameter] = value)
      }
      if (parameter === 'filename')
        return this.filenameField(parameters['filename'], commonProps)
      if (this.isHiddenDefaultValue(parameter))
        return null
      if ((this.qAndSlopeFilters.includes(parameters.type) || this.qAndBandwidthFilters.includes(parameters.type))
        && (parameter === 'q' || parameter === 'slope' || parameter === 'bandwidth'))
        return <this.QorBandwithOrSlope
          {...commonProps}
          parameter={parameter}
          parameters={parameters}
          onDescChange={option => this.props.updateFilter(filter => {
            this.qBandwithSlope.forEach(parameter => { delete filter.parameters[parameter] })
            filter.parameters[option] = this.defaultParameterValues[option]
          })} />

      if (info.type === 'text')
        return <TextOption {...commonProps} />
      if (info.type === 'int')
        return <IntOption {...commonProps} />
      if (info.type === 'float')
        return <FloatOption {...commonProps} />
      if (info.type === 'optional_int')
        return <OptionalIntOption {...commonProps} />
      if (info.type === 'optional_float')
        return <OptionalFloatOption {...commonProps} />
      if (info.type === "bool")
        return <BoolOption {...commonProps} />
      if (info.type === "optional_bool")
        return <OptionalBoolOption {...commonProps} />
      if (info.type === 'floatlist')
        return <FloatListOption {...commonProps} />
      if (info.type === 'enum') {
        let options = info.options
        if (parameter === "fader" && this.props.filter.type === "Volume") {
          options = VolumeFaders
        }
        return <EnumOption {...commonProps} options={options} />
      }
      return null
    })
  }

  private filenameField(
    filename: string,
    props: {
      onChange: (value: any) => void
      "tooltip": string
      value: any
      key: string
      desc: string
    }
  ) {
    const coeffDir = this.props.coeffDir
    const selectedFile = coeffFileNameFromPath(coeffDir, filename)
    return <TextOption
      {...props}
      value={selectedFile}
      onChange={value => this.props.updateFilter(coeffFileNameUpdate(coeffDir, value))} />
  }

  private hasHiddenDefaultValue() {
    const filterDefaults = this.props.filterDefaults
    return filterDefaults
      && Object.keys(filterDefaults).some(parameter => this.isHiddenDefaultValue(parameter))
  }

  private isHiddenDefaultValue(parameter: string) {
    const filter = this.props.filter
    const filterDefaults: any = this.props.filterDefaults
    return !this.props.showDefaults
      && parameter
      && hiddenParameters.includes(parameter)
      && filter.parameters[parameter] === filterDefaults[parameter]
  }

  parameterInfos: {
    [type: string]: {
      type: 'text' | 'int' | 'float' | 'floatlist' | 'bool' | 'optional_bool' | 'optional_int' | 'optional_float'
      desc: string
      tooltip: string
    } | {
      type: 'enum'
      desc: string
      tooltip: string
      options: string[]
    }
  } = {
      a: {
        type: "floatlist",
        desc: "a",
        tooltip: "Comma-separated list of coefficients for a",
      },
      a1: {
        type: "float",
        desc: "a1",
        tooltip: "Value for Biquad a1 coefficient",
      },
      a2: {
        type: "float",
        desc: "a2",
        tooltip: "Value for Biquad a2 coefficient",
      },
      amplitude: {
        type: "float",
        desc: "amplitude",
        tooltip: "Dither amplitude relative to target LSB",
      },
      attenuate_mid: {
        type: "bool",
        desc: "attenuate_mid",
        tooltip: "Attenuate midband instead of boosting extremes, avoids clipping when used with external volume control"
      },
      b0: {
        type: "float",
        desc: "b0",
        tooltip: "Value for Biquad b0 coefficient",
      },
      b: {
        type: "floatlist",
        desc: "b",
        tooltip: "Comma-separated list of coefficients for b",
      },
      b1: {
        type: "float",
        desc: "b1",
        tooltip: "Value for Biquad b1 coefficient",
      },
      b2: {
        type: "float",
        desc: "b2",
        tooltip: "Value for Biquad b2 coefficient",
      },
      bandwidth: {
        type: "float",
        desc: "bandwidth",
        tooltip: "Filter bandwidth in octaves"
      },
      bits: { type: "int", desc: "bits", tooltip: "Target bit depth for dither" },
      channel: {
        type: "optional_int",
        desc: "channel",
        tooltip: "Index of channel to use, starting from 0",
      },
      clip_limit: { type: "float", desc: "clip_limit", tooltip: "Clip limit in dB" },
      delay: { type: "float", desc: "delay", tooltip: "Delay in ms or samples" },
      filename: {
        type: "text",
        desc: "filename",
        tooltip:
          `Filter file name
           <br/>$samplerate$ will be replaced with the current samplerate
           <br/>$channels$ will be replaced with the number of channels of the capture device
          `,
      },
      fader: {
        type: "enum",
        desc: "fader",
        options: LoudnessFaders,
        tooltip: "Fader to react to",
      },
      format: {
        type: "enum",
        desc: "format",
        options: ["S16LE", "S24LE", "S24LE3", "S32LE", "FLOAT32LE", "FLOAT64LE", "TEXT"],
        tooltip: "Sample format",
      },
      freq: { type: "float", desc: "freq", tooltip: "Frequency" },
      freq_act: {
        type: "float",
        desc: "freq_act",
        tooltip: "Frequency of actual system",
      },
      freq_max: {
        type: "float",
        desc: "freq_max",
        tooltip: "Upper frequency limit",
      },
      freq_min: {
        type: "float",
        desc: "freq_min",
        tooltip: "Lower frequency limit",
      },
      freq_p: { type: "float", desc: "freq_p", tooltip: "Pole frequency" },
      freq_target: {
        type: "float",
        desc: "freq_target",
        tooltip: "Target frequency",
      },
      freq_z: { type: "float", desc: "freq_z", tooltip: "Zero frequency" },
      gain: { type: "float", desc: "gain", tooltip: "Gain in dB" },
      high_boost: {
        type: "float",
        desc: "high_boost",
        tooltip: "Volume boost for high frequencies when volume is at reference_level - 20dB",
      },
      inverted: { type: "optional_bool", desc: "inverted", tooltip: "Invert signal" },
      length: {
        type: "int",
        desc: "length",
        tooltip: "Number of coefficients to generate",
      },
      limit: {
        type: "optional_float",
        desc: "limit",
        tooltip: "Volume upper limit in dB",
      },
      low_boost: {
        type: "float",
        desc: "low_boost",
        tooltip: "Volume boost for low frequencies when volume is at reference_level - 20dB",
      },
      mute: { type: "optional_bool", desc: "mute", tooltip: "Mute" },
      normalize_at_dc: {
        type: "bool",
        desc: "normalize_at_dc",
        tooltip: "Normalize at low frequencies"
      },
      order: { type: "int", desc: "order", tooltip: "Filter order" },
      q: { type: "float", desc: "Q", tooltip: "Q-value" },
      q_act: {
        type: "float",
        desc: "Q actual",
        tooltip: "Q-value of actual system",
      },
      q_p: { type: "float", desc: "Q pole", tooltip: "Pole Q-value" },
      q_target: { type: "float", desc: "Q target", tooltip: "Target Q-value" },
      ramp_time: {
        type: "optional_float",
        desc: "ramp_time",
        tooltip: "Volume change ramp time in ms",
      },
      read_bytes_lines: {
        type: "optional_int",
        desc: "read_bytes_lines",
        tooltip: "Read up to this number of bytes or lines",
      },
      reference_level: {
        type: "float",
        desc: "reference_level",
        tooltip: "Volume level at which low_boost/high_boost is starting to be applied.<br>" +
          "Boost is scaled up linearly to reach the full value at reference_level - 20dB.<br>" +
          "Above reference_level only gain is applied.",
      },
      skip_bytes_lines: {
        type: "optional_int",
        desc: "skip_bytes_lines",
        tooltip: "Number of bytes or lines to skip at beginning of file",
      },
      slope: {
        type: "float",
        desc: "slope",
        tooltip: "Filter slope in dB per octave",
      },
      soft_clip: { type: "bool", desc: "soft_clip", tooltip: "Use soft clipping" },
      subsample: {
        type: "bool",
        desc: "subsample",
        tooltip: "Use subsample precision for delays"
      },
      unit: {
        type: "enum",
        desc: "unit",
        options: ["ms", "samples"],
        tooltip: "Unit for delay",
      },
      values: {
        type: "floatlist",
        desc: "values",
        tooltip: "Comma separated list of filter coefficients",
      },
      scale: {
        type: "enum",
        desc: "scale",
        options: ["dB", "linear"],
        tooltip: "Scale for gain",
      },
    }

  qBandwithSlope = ['q', 'slope', 'bandwidth']

  qAndBandwidthFilters = ['Peaking', 'Allpass', 'Notch', 'Bandpass']

  qAndSlopeFilters = ['Lowshelf', 'Highshelf']

  defaultParameterValues: { [parameter: string]: number } = {
    'q': 0.5,
    'slope': 6,
    'bandwidth': 1
  }

  QorBandwithOrSlope(props: {
    parameter: string
    parameters: { [p: string]: any }
    desc: string
    value: number
    error?: string
    tooltip: string
    onDescChange: (option: string) => void
    onChange: (value: number) => void
  }) {
    const { parameter, parameters, desc, value, error, onDescChange, onChange } = props
    let descOptions: { [parameter: string]: string } = {}
    if (this.qAndSlopeFilters.includes(parameters.type))
      ['q', 'slope'].forEach(p => descOptions[p] = this.parameterInfos[p].desc)
    else if (this.qAndBandwidthFilters.includes(parameters.type))
      ['q', 'bandwidth'].forEach(p => descOptions[p] = this.parameterInfos[p].desc)
    else
      return <ErrorMessage message={error} />
    return <>
      <label className="setting" style={{ textAlign: 'right' }} data-tooltip-html={props.tooltip}>
        <EnumInput
          value={parameter}
          options={descOptions}
          desc={desc}
          style={{ display: 'table-cell', width: 'min-content', textAlign: 'right', marginRight: '5px' }}
          tooltip={props.tooltip}
          onChange={onDescChange} />
        <FloatInput
          className="setting-input"
          error={error !== undefined}
          value={value}
          style={{ width: '55%' }}
          tooltip={props.tooltip}
          onChange={onChange} />
        <ErrorMessage message={error} />
      </label>
    </>
  }
}