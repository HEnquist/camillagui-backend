import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';


class InputField extends React.Component {
  constructor(props) {
    super(props);
    console.log(this.props)
    if (this.props.type==="number") {
      this.state = {value: 1000.0};
    }
    else if (this.props.type==="text") {
      this.state = {value: ""};
    }
    else {
      this.state = {value: 0};
    }
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
                  <InputField desc={val} type={this.props.values[val]} />
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
  }

  handleChange(event) {    
    this.setState({value: event.target.value});
    this.props.onSelectFilter(event.target.value);  
  }

  render() {
    return (
      <div>
        <select name="biquad" id="biquad" onChange={this.handleChange}>
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
  }

  handleChange(event) {    
    this.setState({value: event.target.value});  
    this.props.onSelectFilter(event.target.value);  
  }

  render() {
    return (
      <div>
        <select name="filter" id="filter" onChange={this.handleChange}>
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
    this.state = {value: "lowpass"};
  }

  handleChange(event) {    
    this.setState({value: event.target.value}); 
  }

  handleFilter = (bqValue) => {
    this.setState({value: bqValue});
}

  render() {
    var filterselect;
    if (this.state.value==="lowpass") {
      const vals = {'Freq': 'number', 'Q': 'number'};
      filterselect = <ParameterInput  values={vals} />;    
    }
    else if (this.state.value==="highpass") {
      const vals = {'Freq': 'number', 'Q': 'number'};
      filterselect = <ParameterInput  values={vals} />;    
    }
    else if (this.state.value==="highshelf") {
      const vals = {'Freq': 'number', 'Slope': 'number'};
      filterselect = <ParameterInput  values={vals} />;    
    }
    else if (this.state.value==="lowshelf") {
      const vals = {'Freq': 'number', 'Slope': 'number'};
      filterselect = <ParameterInput  values={vals} />;    
    }
    return (
      <div>
      <div>
        <BiquadSelect onSelectFilter={this.handleFilter}/>
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
    this.state = {value: "biquad"};
  }

  handleChange(event) {    
    this.setState({value: event.target.value}); 
  }

  handleFilter = (filtValue) => {
    this.setState({value: filtValue});
  }

  render() {
    var filterselect;
    if (this.state.value==="biquad") {
      filterselect = <Biquad />;    
    }
    else {
      filterselect = <Conv />;  
    };
    return (
      <div className="filter">
        <div><InputField desc="Name" type="text" /></div>
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
    this.state = {filters: []};
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
      const filters = state.filters.concat(<Filter />);
      return {
        filters,
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
          this.state.filters.map(
            (filt, i) => {   
              return (
                <div>
                  <div>
                    {filt}
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
