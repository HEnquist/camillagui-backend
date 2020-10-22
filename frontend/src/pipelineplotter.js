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
      x: x - 5,
      y: y - 3.5,
      width: 10,
      height: 7,
      fill: "none",
      stroke: "black",
      "stroke-width": 1,
    };
    var text = { x: x-4, y: y+1, text: label };
    labels.push(text);
    boxes.push(rect);
  }

  appendFrame(labels, boxes, label, x, y, height) {
    var rect = {
      x: x - 5,
      y: y - 3.5,
      width: 15,
      height: height,
      fill: "none",
      stroke: "red",
      "stroke-width": 1,
    };
    var text = { x: x-4, y: -height/2 + y, text: label };
    labels.push(text);
    boxes.push(rect);
  }

  makeShapes(conf) {
    const spacing_h = 20;
    const spacing_v = 10;
    var labels = [];
    var boxes = [];
    if (!conf.hasOwnProperty("devices")) {
      console.log("-----boxes empty");
      return [labels, boxes];
    }
    var stages = [];
    var channels = [];
    var active_channels = conf["devices"]["capture"]["channels"];
    for (var n = 0; n < active_channels; n++) {
      const label = "ch " + n;
      this.appendBlock(
        labels,
        boxes,
        label,
        0,
        spacing_v * (-active_channels/2 + 0.5 + n)
      );
      //channels.append([b])
    }
    var capturename;
    if (conf["devices"]["capture"].hasOwnProperty("device")) {
      capturename = conf["devices"]["capture"]["device"];
    } else {
      capturename = conf["devices"]["capture"]["filename"];
    }
    this.appendFrame(labels, boxes, capturename, 0, 0, spacing_v*active_channels)
    //draw_box(ax, 0, active_channels, label=capturename)
    //stages.append(channels)

    //# loop through pipeline
    //
    //total_length = 0
    //stage_start = 0
    //if 'pipeline' in conf:
    //    for step in conf['pipeline']:
    //        if step['type'] == 'Mixer':
    //            total_length += 1
    //            name = step['name']
    //            mixconf = conf['mixers'][name]
    //            active_channels = int(mixconf['channels']['out'])
    //            channels = [[]]*active_channels
    //            for n in range(active_channels):
    //                label = "ch {}".format(n)
    //                b = Block(label)
    //                b.place(total_length*2, -active_channels/2 + 0.5 + n)
    //                b.draw(ax)
    //                channels[n] = [b]
    //            for mapping in mixconf['mapping']:
    //                dest_ch = int(mapping['dest'])
    //                for src in mapping['sources']:
    //                    src_ch = int(src['channel'])
    //                    label = "{} dB".format(src['gain'])
    //                    if src['inverted'] == 'False':
    //                        label = label + '\ninv.'
    //                    src_p = stages[-1][src_ch][-1].output_point()
    //                    dest_p = channels[dest_ch][0].input_point()
    //                    draw_arrow(ax, src_p, dest_p, label=label)
    //            draw_box(ax, total_length, active_channels, label=name)
    //            stages.append(channels)
    //            stage_start = total_length
    //        elif step['type'] == 'Filter':
    //            ch_nbr = step['channel']
    //            for name in step['names']:
    //                b = Block(name)
    //                ch_step = stage_start + len(stages[-1][ch_nbr])
    //                total_length = max((total_length, ch_step))
    //                b.place(ch_step*2, -active_channels/2 + 0.5 + ch_nbr)
    //                b.draw(ax)
    //                src_p = stages[-1][ch_nbr][-1].output_point()
    //                dest_p = b.input_point()
    //                draw_arrow(ax, src_p, dest_p)
    //                stages[-1][ch_nbr].append(b)
    //
    //
    //total_length += 1
    //channels = []
    //for n in range(active_channels):
    //    label = "ch {}".format(n)
    //    b = Block(label)
    //    b.place(2*total_length, -active_channels/2 + 0.5 + n)
    //    b.draw(ax)
    //    src_p = stages[-1][n][-1].output_point()
    //    dest_p = b.input_point()
    //    draw_arrow(ax, src_p, dest_p)
    //    channels.append([b])
    //if 'device' in conf['devices']['playback']:
    //    playname = conf['devices']['playback']['device']
    //else:
    //    playname = conf['devices']['playback']['filename']
    //draw_box(ax, total_length, active_channels, label=playname)
    //stages.append(channels)
    //
    //nbr_chan = [len(s) for s in stages]
    //ylim = math.ceil(max(nbr_chan)/2.0) + 0.5
    //ax.set(xlim=(-1, 2*total_length+1), ylim=(-ylim, ylim))
    //plt.axis('off')
    console.log("-----boxes", boxes);
    return [labels, boxes];
  }

  createPipelinePlot() {
    var labels;
    var boxes;
    [labels, boxes] = this.makeShapes(this.props.config);
    const node = this.node;
    //const dataMax = d3.max(this.props.data)
    const yScale = d3.scaleLinear()
        .domain([-50, 50])
        .range([0, this.props.size[1]])
    const xScale = d3.scaleLinear()
        .domain([-10, 90])
        .range([0, this.props.size[0]])
    //d3.select(node)
    // .selectAll('rect')
    // .data(this.props.data)
    // .enter()
    // .append('rect')
    //
    //d3.select(node)
    // .selectAll('rect')
    // .data(this.props.data)
    // .exit()
    // .remove()
    //
    //d3.select(node)
    // .selectAll('rect')
    // .data(this.props.data)
    // .style('fill', '#fe9922')
    // .attr('x', (d,i) => i * 25)
    // .attr('y', d => this.props.size[1] - yScale(d))
    // .attr('height', d => yScale(d))
    // .attr('width', 25)

    var linkGen = d3.linkHorizontal();
    var singleLinkData = { source: [30, 25], target: [130, 155] };
    var multiLinkData = [
      { source: [50, 50], target: [175, 25] },
      { source: [50, 50], target: [175, 50] },
      { source: [50, 50], target: [175, 75] },
    ];

    //var boxes = [{x: 10, y: 10, width: 20, height: 30, fill: "red", stroke: "blue", "stroke-width": 4},
    //  {x: 130, y: 140, width: 20, height: 30, fill: "blue", stroke: "red", "stroke-width": 4},
    //]
    const markerBoxWidth = 20;
    const markerBoxHeight = 20;
    const refX = markerBoxWidth / 2;
    const refY = markerBoxHeight / 2;
    const markerWidth = markerBoxWidth / 2;
    const markerHeight = markerBoxHeight / 2;
    const arrowPoints = [
      [0, 0],
      [0, 20],
      [20, 10],
    ];
    d3.select(node)
      .append("defs")
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", [0, 0, xScale(markerBoxWidth)-xScale(0), yScale(markerBoxHeight)-yScale(0)])
      .attr("refX", xScale(refX))
      .attr("refY", yScale(refY))
      .attr("markerWidth", xScale(markerBoxWidth)-xScale(0))
      .attr("markerHeight", yScale(markerBoxHeight)-yScale(0))
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

    var rectAttributes = rects
      .attr("x", function (d) {
        return xScale(d.x);
      })
      .attr("y", function (d) {
        return yScale(d.y);
      })
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

    //var labels = [{x: 100, y:100, text: "hello"},
    //  {x: 100, y:120, text: "bye"}]

    var text = d3
      .select(node)
      .selectAll("text")
      .data(labels)
      .enter()
      .append("text");

    //Add SVG Text Element Attributes
    var textLabels = text
      .attr("x", function (d) {
        return xScale(d.x);
      })
      .attr("y", function (d) {
        return yScale(d.y);
      })
      .text(function (d) {
        return d.text;
      })
      .attr("font-family", "sans-serif")
      .attr("font-size", "20px")
      .attr("fill", "red");

    d3.select(node)
      .selectAll(null)
      .data(multiLinkData)
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
