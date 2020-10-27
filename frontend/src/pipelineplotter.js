import Popup from "reactjs-popup";
import * as d3 from "d3";
import React from "react";
import "./index.css";

class BarChart extends React.Component {
  constructor(props) {
    super(props);
    this.createBarChart = this.createPipelinePlot.bind(this);
  }

  componentDidMount() {
    this.createPipelinePlot();
  }

  componentDidUpdate() {
    this.createPipelinePlot();
  }

  appendBlock(labels, boxes, label, x, y) {
    var rect = {
      x: x - 0.5,
      y: y - 0.35,
      width: 1.0,
      height: 0.7,
      fill: "white",
      stroke: "black",
      "stroke-width": 1,
    };
    var text = { x: x, y: y+0.1, text: label, fill: "black", size: 0.3, angle: 0 };
    labels.push(text);
    boxes.push(rect);
    return {output: {x: x+0.5, y: y}, input: {x: x-0.5, y: y}};
  }

  appendFrame(labels, boxes, label, x, y, height) {
    var rect = {
      x: x - 0.75,
      y: -height/2 + y,
      width: 1.5,
      height: height,
      fill: "lightgray",
      stroke: "lightgray",
      "stroke-width": 1,
    };
    var text = { x: x, y: -height/2 - 0.2 + y, text: label, fill: "blue", size: 0.4, angle: 0 };
    labels.push(text);
    boxes.push(rect);
  }

  appendLink(links, labels, source, dest, label) {
    var newlink = {source: [source.x, source.y], target: [dest.x, dest.y]}
    if (label) {
      var angle = 1.5*180/3.14 * (dest.y-source.y)/(dest.x-source.x);
      var text;
      if (dest.y<=source.y) {
        text = { x: 2*source.x/3 + dest.x/3, y: 2*source.y/3 + dest.y/3, text: label, fill: "black", size: 0.2, angle: angle};
      }
      else {
        text = { x: source.x/3 + 2*dest.x/3, y: source.y/3 + 2*dest.y/3, text: label, fill: "black", size: 0.2, angle: angle};
      }
      labels.push(text);
    }
    links.push(newlink);
  }

  makeShapes(conf) {
    const spacing_h = 3;
    const spacing_v = 1;
    var labels = [];
    var boxes = [];
    var links = [];
    if (!conf.hasOwnProperty("devices")) {
      console.log("-----boxes empty");
      return [labels, boxes];
    }
    var stages = [];
    var channels = [];
    var active_channels = conf["devices"]["capture"]["channels"];
    var capturename;
    if (conf["devices"]["capture"].hasOwnProperty("device")) {
      capturename = conf["devices"]["capture"]["device"];
    } else {
      capturename = conf["devices"]["capture"]["filename"];
    }
    this.appendFrame(labels, boxes, capturename, 0, 0, spacing_v*active_channels)
    for (var n = 0; n < active_channels; n++) {
      const label = "ch " + n;
      const io_points = this.appendBlock(
        labels,
        boxes,
        label,
        0,
        spacing_v * (-active_channels/2 + 0.5 + n)
      );
      channels.push([io_points])
    }
    stages.push(channels);


    // loop through pipeline
    //
    var total_length = 0;
    var stage_start = 0;
    if (conf.hasOwnProperty("pipeline")) {
      for (n = 0; n < conf.pipeline.length; n++) {
        var step = conf.pipeline[n];
        if (step.type === 'Mixer') {
          total_length += 1;
          var mixername = step['name'];
          var mixconf = conf['mixers'][mixername];
          active_channels = parseInt(mixconf['channels']['out']);
          var mixerchannels = [];
          this.appendFrame(labels, boxes, mixername, spacing_h*total_length, 0, spacing_v*active_channels)
          for (var m = 0; m < active_channels; m++) {
            mixerchannels.push([])
            var label = "ch "+m;
            var io_points = this.appendBlock(labels,
              boxes,
              label,
              total_length*spacing_h,
              spacing_v * (-active_channels/2 + 0.5 + m))
            mixerchannels[m].push(io_points);
          }
          for (m = 0; m < mixconf.mapping.length; m++) {
            console.log("m", m)
            var mapping = mixconf.mapping[m];
            var dest_ch = parseInt(mapping.dest);
            console.log("destination", dest_ch)
            for (var p = 0; p < mapping.sources.length; p++) {
              console.log("p", p)
              var src = mapping.sources[p];
              var src_ch = parseInt(src.channel);
              label = src.gain + " dB";
              if (src.inverted) {
                label = label + " inv.";
              }
              var srclen = stages[stages.length-1][src_ch].length;
              var src_p = stages[stages.length-1][src_ch][srclen-1].output
              var dest_p = mixerchannels[dest_ch][0].input
              this.appendLink(links, labels, src_p, dest_p, label);
            }
          }
          stages.push(mixerchannels);
          stage_start = total_length;              
        }
        else if (step.type === 'Filter') {
          var ch_nbr = parseInt(step.channel);
          for (m = 0; m < step.names.length; m++) {
            var name = step.names[m];
            console.log("stages", stages[stages.length-1][ch_nbr])
            var ch_step = stage_start + stages[stages.length-1][ch_nbr].length;
            total_length = Math.max(total_length, ch_step);
            io_points = this.appendBlock(labels,
              boxes,
              name,
              ch_step*spacing_h,
              spacing_v * (-active_channels/2 + 0.5 + ch_nbr));
            //var src_list = stages[stages.length-1][ch_nbr];
            //var src_p = src_list[src_list.length-1].output;
            //var dest_p = io_points.output;
            //stages[stages.length-1][ch_nbr].push(io_points);
            //this.appendLink(links, src_p, dest_p);
          }
        }
      }
    }
    var playbackchannels = [];
    total_length = total_length +1;
    var playbackname;
    if (conf["devices"]["playback"].hasOwnProperty("device")) {
      playbackname = conf["devices"]["playback"]["device"];
    } else {
      playbackname = conf["devices"]["playback"]["filename"];
    }
    this.appendFrame(labels, boxes, playbackname, spacing_h*total_length, 0, spacing_v*active_channels)
    for (n = 0; n < active_channels; n++) {
      const label = "ch " + n;
      const io_points = this.appendBlock(
        labels,
        boxes,
        label,
        spacing_h*total_length,
        spacing_v * (-active_channels/2 + 0.5 + n)
      );
      playbackchannels.push([io_points])
      srclen = stages[stages.length-1][n].length;
      src_p = stages[stages.length-1][n][srclen-1].output
      dest_p = io_points.input
      this.appendLink(links, labels, src_p, dest_p, null);
    }
    stages.push(playbackchannels);

    console.log("-----boxes", boxes);
    return [labels, boxes, links];
  }

  createPipelinePlot() {
    var labels;
    var boxes;
    var links;
    [labels, boxes, links] = this.makeShapes(this.props.config);
    console.log(labels)
    console.log(boxes)
    console.log(links)
    const node = this.node;
    const yScale = d3.scaleLinear()
        .domain([-5, 5])
        .range([0, this.props.size[1]])
    const xScale = d3.scaleLinear()
        .domain([-1, 9])
        .range([0, this.props.size[0]])

    var linkGen = d3.linkHorizontal().source(d => [xScale(d.source[0]), yScale(d.source[1])]).target(d => [xScale(d.target[0]), yScale(d.target[1])]);

    const markerBoxWidth = 7;
    const markerBoxHeight = 7;
    const refX = markerBoxWidth;
    const refY = markerBoxHeight / 2;
    const arrowPoints = [
      [0, 0],
      [0, markerBoxHeight],
      [markerBoxWidth, markerBoxHeight/2],
    ];
    d3.select(node)
      .append("defs")
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", [0, 0, markerBoxWidth, markerBoxHeight])
      .attr("refX", refX)
      .attr("refY", refY)
      .attr("markerWidth", markerBoxWidth)
      .attr("markerHeight", markerBoxHeight)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", d3.line()(arrowPoints))
      .attr("stroke", "black");

    var rects = d3
      .select(node)
      .selectAll("rect")
      .data(boxes)
      .enter()
      .append("rect");

    rects
      .attr("x", function (d) {
        return xScale(d.x);
      })
      .attr("y", function (d) {
        return yScale(d.y);
      })
      .attr("rx", xScale(0.1)-xScale(0))
      .attr("ry", yScale(0.1)-yScale(0))
      .attr("width", function (d) {
        return xScale(d.width)-xScale(0);
      })
      .attr("height", function (d) {
        return yScale(d.height)-yScale(0);
      })
      .style("fill", function (d) {
        return d.fill;
      })
      .style("stroke", function (d) {
        return d.stroke;
      })
      .style("stroke-width", function (d) {
        return d["stroke-width"];
      });

    var text = d3
      .select(node)
      .selectAll("text")
      .data(labels)
      .enter()
      .append("text");

    //Add SVG Text Element Attributes
    text
      .text(function (d) {
        return d.text;
      })
      .attr("font-size", function (d) {
        return (yScale(d.size)-yScale(0))+"px";
      })
      .attr("fill", function (d) {
        return d.fill;
      })
      .style("text-anchor", "middle")
      .attr("transform", function(d) {
        return "translate(" + xScale(d.x) +  "," + yScale(d.y)+ "), rotate("+d.angle+")";
      })
      .attr("font-family", "sans-serif");

    d3.select(node)
      .selectAll(null)
      .data(links)
      .join("path")
      .attr("d", linkGen)
      .attr("marker-end", "url(#arrow)")
      .attr("fill", "none")
      .attr("stroke", "black");
  }

  render() {
    return (
      <svg ref={(node) => (this.node = node)} width={500} height={500}></svg>
    );
  }
}



// ------------------------PipelinePopup---------------------------------------------------
export class PipelinePopup extends React.Component {
  constructor(props) {
    super(props);
    this.state = { open: props.open, config: props.config };
    this.openModal = this.openModal.bind(this);
    this.closeModal = this.closeModal.bind(this);
  }
  openModal() {
    this.setState({ open: true });
  }

  closeModal() {
    this.setState({ open: false });
    this.props.onClose(this.props.id);
  }

  render() {
    return (
      <div>
        <Popup
          open={this.state.open}
          closeOnDocumentClick
          onClose={this.closeModal}
        >
          <div className="modal">
            <span className="close" onClick={this.closeModal}>
              ✖
            </span>
            <div>
              <BarChart size={[500, 500]} config={this.state.config} />
            </div>
          </div>
        </Popup>
      </div>
    );
  }
}
