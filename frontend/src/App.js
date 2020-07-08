import React from 'react';
import ReactDOM from 'react-dom';
import './App.css';

class Frequency extends React.Component {
  constructor(props) {
    super(props);    
    this.state = {
      value: 1000.0,
    };  
  }
  render() {
    return (
      <input type="number" className="freq">{this.props.value}</input>
    );
  }
}

ReactDOM.render(
  <Frequency />,
  document.getElementById('root')
);