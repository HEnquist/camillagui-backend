import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import { FilterList } from './filterlist.js';
import { Capture } from './devices.js';

class CamillaConfig extends React.Component {
    constructor(props) {
      super(props);
      //this.handleChange = this.handleChange.bind(this);
      //this.state = {value: this.props.value};
    }
  
    //handleChange(event) {    
    //  this.setState({value: event.target.value});  
    //  this.props.onSelectFilter(event.target.value);  
    //}
  
    render() {
      return (
        <div>  
        <div>
            <Capture />;
        </div> 
        <div>
            <FilterList />;
        </div>
        </div> 
      );
    }
}


ReactDOM.render(
    //<BiquadFQ desc="2nd order lowpass"/>,
        <CamillaConfig />,
    document.getElementById('root')
  );