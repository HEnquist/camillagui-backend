import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import { FilterList } from './filterlist.js';

ReactDOM.render(
    //<BiquadFQ desc="2nd order lowpass"/>,
    <FilterList />,
    document.getElementById('root')
  );