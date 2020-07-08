import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';


class InputField extends React.Component {
  constructor(props) {
    super(props);
    console.log(this.props)
    this.state = {value: this.props.value};
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(event) {    
    this.setState({value: event.target.value});  
  }

  render() {
    return (
      <label>
        {this.props.desc}:
        <input type={this.props.type} value={this.state.value} onChange={this.handleChange} />        
      </label>
    );
  }
}


class ParameterInput extends React.Component {
  constructor(props) {
    super(props);
  }

  render() {
    return (
      <div>
        <div className="desc">{this.props.desc}</div>
        {
          Object.keys(this.props.values).map(
            (val, i) => {   
              return (
                <div>
                  <InputField desc={val} type={this.props.values[val].type} value={this.props.values[val].value} />
                </div>
              )
            }
          )
        }
      </div> 
    );
  }
}

class BiquadSelect extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = {value: this.props.value};
  }

  handleChange(event) {    
    this.setState({value: event.target.value});
    this.props.onSelectFilter(event.target.value);  
  }

  render() {
    return (
      <div>
        <select name="biquad" id="biquad" onChange={this.handleChange} value={this.state.value}>
          <option value="lowpass">Lowpass</option>
          <option value="highpass">Highpass</option>
          <option value="highshelf">Higlshelf</option>
          <option value="lowshelf">Lowshelf</option>
        </select>
      </div> 
    );
  }
}

class ConvSelect extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(event) {    
    this.setState({value: event.target.value});
    this.props.onSelectFilter(event.target.value);  
  }

  render() {
    return (
      <div>
        <select name="conv" id="conv" onChange={this.handleChange}>
          <option value="file">File</option>
          <option value="values">Values</option>
        </select>
      </div> 
    );
  }
}

class FilterSelect extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = {value: this.props.value};
  }

  handleChange(event) {    
    this.setState({value: event.target.value});  
    this.props.onSelectFilter(event.target.value);  
  }

  render() {
    return (
      <div>
        <select name="filter" id="filter" onChange={this.handleChange} value={this.state.value}>
          <option value="biquad">Biquad</option>
          <option value="conv">Conv</option>
        </select>
      </div> 
    );
  }
}

class Biquad extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = {type: this.props.type, parameters: this.props.parameters};
    console.log(this.state);
  }

  handleChange(event) {    
    this.setState({value: event.target.value}); 
  }

  handleFilter = (bqValue) => {
    this.setState({value: bqValue});
}

  render() {
    var filterselect;
    if (this.state.parameters.type==="lowpass") {
      const vals = {'Freq': {type: 'number', value: this.state.parameters.freq}, 'Q': {type: 'number', value: this.state.parameters.Q}};
      filterselect = <ParameterInput  values={vals} />;    
    }
    else if (this.state.parameters.type==="highpass") {
      const vals = {'Freq': {type: 'number', value: this.state.parameters.freq}, 'Q': {type: 'number', value: this.state.parameters.Q}};
      filterselect = <ParameterInput  values={vals} />;    
    }
    else if (this.state.parameters.type==="highshelf") {
      const vals = {'Freq': {type: 'number', value: this.state.parameters.freq}, 'Slope': {type: 'number', value: this.state.parameters.Q}};
      filterselect = <ParameterInput  values={vals} />;    
    }
    else if (this.state.parameters.type==="lowshelf") {
      const vals = {'Freq': {type: 'number', value: this.state.parameters.freq}, 'Slope': {type: 'number', value: this.state.parameters.Q}};
      filterselect = <ParameterInput  values={vals} />;    
    }
    return (
      <div>
      <div>
        <BiquadSelect value={this.state.parameters.type} onSelectFilter={this.handleFilter}/>
      </div>
      <div>
        {filterselect}
      </div>
      </div> 
    );
  }
}

class Conv extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = {value: "file"};
  }

  handleChange(event) {    
    this.setState({value: event.target.value}); 
  }

  handleFilter = (value) => {
    this.setState({value: value});
}

  render() {
    var filterselect;
    if (this.state.value==="file") {
      const vals = {'Path': 'text'};
      filterselect = <ParameterInput  values={vals} />;    
    }
    else if (this.state.value==="values") {
      const vals = {'Values': 'text'};
      filterselect = <ParameterInput  values={vals} />;    
    }
    return (
      <div>
      <div>
        <ConvSelect onSelectFilter={this.handleFilter}/>
      </div>
      <div>
        {filterselect}
      </div>
      </div> 
    );
  }
}

class Filter extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = {type: this.props.type, parameters: this.props.parameters};
    //this.state = {value: "biquad"};
  }

  handleChange(event) {    
    this.setState({value: event.target.value}); 
  }

  handleFilter = (filtValue) => {
    this.setState({value: filtValue});
  }

  render() {
    var filterselect;
    if (this.props.type==="biquad") {
      filterselect = <Biquad type={this.state.type} parameters={this.state.parameters}/>;    
    }
    else {
      filterselect = <Conv params={this.state.parameters}/>;  
    };
    return (
      <div className="filter">
        <div>
          <FilterSelect onSelectFilter={this.handleFilter}/>
        </div>
        <div>
          {filterselect}
        </div>
      </div> 
    );
  }
}

class FilterList extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
    this.state = {filters: {}, nbr: 0};
  }

  handleChange(event) {    
    this.setState({value: event.target.value}); 
  }

  handleFilter = (filtValue) => {
    this.setState({value: filtValue});
  }

  addFilter = (event) => {
    event.preventDefault();
    this.setState(state => {
      const nbr = state.nbr + 1;
      const newname = "new"+nbr.toString();
      const filters = Object.assign({}, state.filters, {[newname]: {"type": "biquad", "parameters": {"type": "lowpass", "Q": 0.5, "freq": 1000}}});
      console.log(filters);
      return {
        filters,
        nbr,
      };
    });
  }

  removeFilter = (event) => {
    console.log(event.target);
    var i = parseInt(event.target.id);
    this.setState(state => {
      const filters = state.filters.filter((item, j) => i !== j);
      console.log(filters);
      return {
        filters,
      };
    });
  };

  render() {
    return (
      <div>
        <div className="desc">Filters</div>
        {
          Object.keys(this.state.filters).map(
            (filt, i) => {   
              return (
                <div>
                  <div><InputField desc="Name" type="text" value={filt}/></div>
                  <div>
                    <Filter type={this.state.filters[filt].type} parameters={this.state.filters[filt].parameters} />
                  </div>
                  <div>
                    <button onClick={this.removeFilter} id={i}>del</button>
                  </div>
                </div>
              )
            }
          )
        }
        <button onClick={this.addFilter}>+</button>
      </div> 
    );
  }
}

ReactDOM.render(
  //<BiquadFQ desc="2nd order lowpass"/>,
  <FilterList />,
  document.getElementById('root')
);


// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
//serviceWorker.unregister();
