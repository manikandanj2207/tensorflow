/* Copyright 2015 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the 'License');
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an 'AS IS' BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/
module tf.graph.scene.node {
  import RenderNodeInfo = tf.graph.render.RenderNodeInfo;
  /**
   * Select or Create a 'g.nodes' group to a given sceneGroup
   * and builds a number of 'g.node' groups inside the group.
   *
   * Structure Pattern:
   *
   * <g class='nodes'>
   *   <g class='node'>
   *     <g class='in-annotations'>
   *       ...
   *     </g>
   *     <g class='out-annotations'>
   *       ...
   *     </g>
   *     <g class='nodeshape'>
   *      <!--
   *      Content of the node shape should be for the node itself. For example a
   *      Metanode would have a <rect> with rounded edges, an op would have an
   *      <ellipse>. More complex nodes like series may contain multiple
   *      elements which are conditionally visible based on whether the node is
   *      expanded.
   *      -->
   *     </g>
   *     <text class='label'>node name</text>
   *     <g class='subscene'>
   *       <!--
   *       Content of  the subscene (only for metanode and series node).
   *
   *       Subscene is a svg group that contains content of the
   *       metanode's metagraph that is recursively generated by Scene.build().
   *
   *       When the graph is expanded multiple times, a subscene can contain
   *       nested subscenes inside.
   *       -->
   *     </g>
   *   </g>
   *   ...
   * </g>
   *
   *
   * @param sceneGroup selection of the container
   * @param nodeData array of render node information to map
   * @param sceneElement <tf-graph-scene> polymer element
   * @return selection of the created nodeGroups
   */
  export function buildGroup(
      sceneGroup, nodeData: render.RenderNodeInfo[], sceneElement) {
    let container =
        scene.selectOrCreateChild(sceneGroup, 'g', Class.Node.CONTAINER);
    // Select all children and join with data.
    // (Note that all children of g.nodes are g.node)
    let nodeGroups =
        container
            .selectAll(function() {
              // using d3's selector function
              // See https://github.com/mbostock/d3/releases/tag/v2.0.0
              // (It's not listed in the d3 wiki.)
              return this.childNodes;  // this here refers to container.node()
            })
            .data(nodeData, (d) => {
              // make sure that we don't have to swap shape type
              return d.node.name + ':' + d.node.type;
            });

    // ENTER
    nodeGroups.enter()
        .append('g')
        .attr('data-name', d => { return d.node.name; })
        .each(function(d) {
          let nodeGroup = d3.select(this);
          // index node group for quick stylizing
          sceneElement.addNodeGroup(d.node.name, nodeGroup);
        });

    // UPDATE
    nodeGroups
        .attr('class', d => { return Class.Node.GROUP + ' ' + nodeClass(d); })
        .each(function(d) {
          let nodeGroup = d3.select(this);
          // Add g.in-annotations (always add -- to keep layer order
          // consistent.)
          let inAnnotationBox =
              scene.selectOrCreateChild(nodeGroup, 'g', Class.Annotation.INBOX);
          annotation.buildGroup(
              inAnnotationBox, d.inAnnotations, d, sceneElement);

          // Add g.out-annotations  (always add -- to keep layer order
          // consistent.)
          let outAnnotationBox = scene.selectOrCreateChild(
              nodeGroup, 'g', Class.Annotation.OUTBOX);
          annotation.buildGroup(
              outAnnotationBox, d.outAnnotations, d, sceneElement);

          // Build .shape first (background of the node).
          let shape = buildShape(nodeGroup, d, Class.Node.SHAPE);
          if (d.node.isGroupNode) {
            addButton(shape, d, sceneElement);
          }
          addInteraction(shape, d, sceneElement);

          // Build subscene on the top.
          subsceneBuild(nodeGroup, <render.RenderGroupNodeInfo>d, sceneElement);

          // Build label last. Should be on top of everything else.
          let label = labelBuild(nodeGroup, d, sceneElement);
          // Do not add interaction to metanode labels as they live inside the
          // metanode shape which already has the same interactions.
          addInteraction(label, d, sceneElement, d.node.type === NodeType.META);

          stylize(nodeGroup, d, sceneElement);
          position(nodeGroup, d);
        });

    // EXIT
    nodeGroups.exit()
        .each(function(d) {
          // remove all indices on remove
          sceneElement.removeNodeGroup(d.node.name);

          let nodeGroup = d3.select(this);
          if (d.inAnnotations.list.length > 0) {
            nodeGroup.select('.' + Class.Annotation.INBOX)
                .selectAll('.' + Class.Annotation.GROUP)
                .each(a => { sceneElement.removeAnnotationGroup(a, d); });
          }
          if (d.outAnnotations.list.length > 0) {
            nodeGroup.select('.' + Class.Annotation.OUTBOX)
                .selectAll('.' + Class.Annotation.GROUP)
                .each(a => { sceneElement.removeAnnotationGroup(a, d); });
          }
        })
        .remove();
    return nodeGroups;
};

/**
 * Update or remove the subscene of a render group node depending on whether it
 * is a expanded. If the node is not a group node, this method has no effect.
 *
 * @param nodeGroup selection of the container
 * @param renderNodeInfo the render information for the node.
 * @param sceneElement <tf-graph-scene> polymer element.
 * @return Selection of the subscene group, or null if node group does not have
 *        a subscene. Op nodes, bridge nodes and unexpanded group nodes will
 *        not have a subscene.
 */
function subsceneBuild(nodeGroup,
    renderNodeInfo: render.RenderGroupNodeInfo, sceneElement) {
  if (renderNodeInfo.node.isGroupNode) {
    if (renderNodeInfo.expanded) {
      // Recursively build the subscene.
      return scene.buildGroup(nodeGroup, renderNodeInfo, sceneElement,
        Class.Subscene.GROUP);
    }
    // Clean out existing subscene if the node is not expanded.
    scene.selectChild(nodeGroup, 'g', Class.Subscene.GROUP).remove();
  }
  return null;
};

/**
 * Translate the subscene of the given node group
 */
function subscenePosition(nodeGroup, d: render.RenderNodeInfo) {
  let x0 = d.x - d.width / 2.0 + d.paddingLeft;
  let y0 = d.y - d.height / 2.0 + d.paddingTop;

  let subscene = scene.selectChild(nodeGroup, 'g', Class.Subscene.GROUP);
  scene.translate(subscene, x0, y0);
};

/**
 * Add an expand/collapse button to a group node
 *
 * @param selection The group node selection.
 * @param d Info about the node being rendered.
 * @param sceneElement <tf-graph-scene> polymer element.
 */
function addButton(selection, d: render.RenderNodeInfo, sceneElement) {
  let group =
      scene.selectOrCreateChild(selection, 'g', Class.Node.BUTTON_CONTAINER);
  scene.selectOrCreateChild(group, 'circle', Class.Node.BUTTON_CIRCLE);
  scene.selectOrCreateChild(group, 'path', Class.Node.EXPAND_BUTTON)
      .attr('d', 'M0,-2.2 V2.2 M-2.2,0 H2.2');
  scene.selectOrCreateChild(group, 'path', Class.Node.COLLAPSE_BUTTON)
      .attr('d', 'M-2.2,0 H2.2');
  group.on('click', d => {
    // Stop this event's propagation so that it isn't also considered a
    // node-select.
    (<Event>d3.event).stopPropagation();
    sceneElement.fire('node-toggle-expand', {name: d.node.name});
  });
  scene.positionButton(group, d);
};

/**
 * Fire node-* events when the selection is interacted.
 *
 * @param disableInteraction When true, have the provided selection
 * ignore all pointer events. Used for text labels inside of metanodes, which
 * don't need interaction as their surrounding shape has interaction, and if
 * given interaction would cause conflicts with the expand/collapse button.
 */
function addInteraction(selection, d: render.RenderNodeInfo,
    sceneElement, disableInteraction?: boolean) {
  if (disableInteraction) {
    selection.attr('pointer-events', 'none');
    return;
  }

  let contextMenuFunction = contextmenu.getMenu(
    getContextMenu(d.node, sceneElement));
  selection
      .on('dblclick',
          d => {
            sceneElement.fire('node-toggle-expand', {name: d.node.name});
          })
      .on('mouseover',
          d => {
            // don't send mouseover over expanded group,
            // otherwise it is causing too much glitches
            if (sceneElement.isNodeExpanded(d)) {
              return;
            }

            sceneElement.fire('node-highlight', {name: d.node.name});
          })
      .on('mouseout',
          d => {
            // don't send mouseover over expanded group,
            // otherwise it is causing too much glitches
            if (sceneElement.isNodeExpanded(d)) {
              return;
            }

            sceneElement.fire('node-unhighlight', {name: d.node.name});
          })
      .on('click',
          d => {
            // Stop this event's propagation so that it isn't also considered
            // a graph-select.
            (<Event>d3.event).stopPropagation();
            sceneElement.fire('node-select', {name: d.node.name});
          })
      .on('contextmenu', (d, i) => {
        sceneElement.fire('node-select', {name: d.node.name});
        contextMenuFunction.call(d, i);
      });
};

/**
 * Returns the d3 context menu specification for the provided node.
 */
export function getContextMenu(node: Node, sceneElement) {
  let menu = [{
    title: (d): string => {
      return getIncludeNodeButtonString(node.include);
    },
    action: (elm, d, i) => {
      sceneElement.fire('node-toggle-extract', {name: node.name});
    }
  }];
  if (canBeInSeries(node)) {
    menu.push({
      title: d => { return getGroupSettingLabel(node); },
      action: (elm, d, i) => {
        sceneElement.fire(
            'node-toggle-seriesgroup', {name: getSeriesName(node)});
      }
    });
  }
  return menu;
}

/** Returns if a node can be part of a grouped series */
export function canBeInSeries(node: Node) {
  return getSeriesName(node) !== null;
}

/**
 * Returns the name of the possible grouped series containing this node.
 * Returns null if the node cannot be part of a grouped series of nodes.
 */
export function getSeriesName(node: Node) {
  if (!node) {
    return null;
  }
  if (node.type === NodeType.SERIES) {
    return node.name;
  }
  if (node.type === NodeType.OP) {
    let op = <OpNode>node;
    return op.owningSeries;
  }
  return null;
}

/**
 * Returns the SeriesNode that represents the series that the provided node
 * is contained in (or itself if the provided node is itself a SeriesNode).
 * Returns null if the node is not rendered as part of a series.
 */
function getContainingSeries(node: Node) {
  let s: SeriesNode = null;
  if (!node) {
    return null;
  } else if (node.type === NodeType.SERIES) {
    s = <SeriesNode>node;
  } else if (node.parentNode && node.parentNode.type === NodeType.SERIES) {
    s = <SeriesNode>node.parentNode;
  }
  return s;
}

/**
 * Returns the label for a button to toggle the group setting of the provided
 * node.
 */
export function getGroupSettingLabel(node: Node) {
  return tf.graph.getGroupSeriesNodeButtonString(
    getContainingSeries(node) !== null ? tf.graph.SeriesGroupingType.GROUP :
     tf.graph.SeriesGroupingType.UNGROUP);
}

/**
 * Append svg text for label and assign data.
 * @param nodeGroup
 * @param renderNodeInfo The render node information for the label.
 * @param sceneElement <tf-graph-scene> polymer element.
 */
function labelBuild(nodeGroup, renderNodeInfo: render.RenderNodeInfo,
    sceneElement) {
  let namePath = renderNodeInfo.node.name.split('/');
  let text = namePath[namePath.length - 1];

  // Truncate long labels for unexpanded Metanodes.
  let useFontScale = renderNodeInfo.node.type === NodeType.META &&
    !renderNodeInfo.expanded;

  let label = scene.selectOrCreateChild(nodeGroup, 'text', Class.Node.LABEL);

  // Make sure the label is visually on top among its siblings.
  let labelNode = <HTMLElement> label.node();
  labelNode.parentNode.appendChild(labelNode);

  label.attr('dy', '.35em').attr('text-anchor', 'middle');
  if (useFontScale) {
    if (text.length > sceneElement.maxMetanodeLabelLength) {
      text = text.substr(0, sceneElement.maxMetanodeLabelLength - 2) + '...';
    }
    let scale = getLabelFontScale(sceneElement);
    label.attr('font-size', scale(text.length) + 'px');
  }

  let txtElement = <d3.Selection<any>>label.text(text);
  enforceLabelWidth(txtElement, renderNodeInfo.node.type, renderNodeInfo);
  return label;
}
/**
 * This function shortens text which would exceed the maximum pixel width of
 * a label.
 *
 * @param txtElementSelection The text element containing the label's text as d3
 * selection.
 * @param nodeType The type of the node the label belongs to. If the node is
 * an annotation, the value is -1. Label widths are defined in
 * layout.PARAMS.nodeSize.{meta|op|...}.maxLabelWidth for nodes and
 * layout.PARAMS.annotations.labelWidth for annotations.
 * @param renderNodeInfo The render information about the node, required to
 * determine whether META nodes are collapsed or expanded.
 */
export function enforceLabelWidth(
    txtElementSelection: d3.Selection<any>, nodeType: NodeType | number,
    renderNodeInfo?: render.RenderNodeInfo) {
  // Get text element itself and its on-screen width.
  let txtNode = <SVGTextElement>txtElementSelection.node();
  let computedTxtLength = txtNode.getComputedTextLength();
  let labelContent = txtNode.textContent;

  // Get maximum length from settings.
  let maxLength = null;
  switch (nodeType) {
    case NodeType.META:
      if (renderNodeInfo && !renderNodeInfo.expanded) {  // Only trim text if
        // node expanded.
        maxLength = layout.PARAMS.nodeSize.meta.maxLabelWidth;
      }
      break;

    case NodeType.OP:
      maxLength = layout.PARAMS.nodeSize.op.maxLabelWidth;
      break;

    case -1:
      maxLength = layout.PARAMS.annotations.maxLabelWidth;
      break;

    default:
      break;
  }

  // Return if no max length provided for node type, or current label length is
  // less than or equal to the provided length limit.
  if (maxLength === null || computedTxtLength <= maxLength) {
    return;
  }

  // Find the index of the character which exceeds the width.
  // getSubStringLength performs far better than getComputedTextLength, and
  // results in a 3x speed-up on average.
  let index = 1;
  while (txtNode.getSubStringLength(0, index) < maxLength) {
    index++;
  }

  // Shorten the label starting at the string length known to be one
  // character above max pixel length.
  // When shortened the original label's substring is concatenated with
  // '...', baseText contains the substring not including the '...'.
  let baseText = <string>txtNode.textContent.substr(0, index);
  do {
    baseText = baseText.substr(0, baseText.length - 1);

    // Recompute text length.
    txtNode.textContent = baseText + '...';
    computedTxtLength = txtNode.getComputedTextLength();
  } while (computedTxtLength > maxLength && baseText.length > 0);

  // Add tooltip with full name and return.
  return txtElementSelection.append('title').text(labelContent);
}

/**
 * d3 scale used for sizing font of labels, used by labelBuild,
 * initialized once by getLabelFontScale.
 */
let fontScale = null;
function getLabelFontScale(sceneElement) {
  if (!fontScale) {
    fontScale = d3.scale.linear()
      .domain([sceneElement.maxMetanodeLabelLengthLargeFont,
        sceneElement.maxMetanodeLabelLength])
      .range([sceneElement.maxMetanodeLabelLengthFontSize,
        sceneElement.minMetanodeLabelLengthFontSize]).clamp(true);
  }
  return fontScale;
}

/**
 * Set label position of a given node group
 */
function labelPosition(nodeGroup, cx: number, cy: number,
    yOffset: number) {
  scene.selectChild(nodeGroup, 'text', Class.Node.LABEL)
      .transition()
      .attr('x', cx)
      .attr('y', cy + yOffset);
};

/**
 * Select or append/insert shape for a node and assign renderNode
 * as the shape's data.
 *
 * @param nodeGroup
 * @param d Render node information.
 * @param nodeClass class for the element.
 * @return Selection of the shape.
 */
export function buildShape(nodeGroup, d, nodeClass: string) {
  // Create a group to house the underlying visual elements.
  let shapeGroup = scene.selectOrCreateChild(nodeGroup, 'g', nodeClass);
  // TODO (jimbo): DOM structure should be templated in HTML somewhere, not JS. id:2311
  switch (d.node.type) {
    case NodeType.OP:
      scene.selectOrCreateChild(shapeGroup, 'ellipse', Class.Node.COLOR_TARGET);
      break;
    case NodeType.SERIES:
      // Choose the correct stamp to use to represent this series.
      let stampType = 'annotation';
      let groupNodeInfo = <render.RenderGroupNodeInfo>d;
      if (groupNodeInfo.coreGraph) {
        stampType =
            groupNodeInfo.node.hasNonControlEdges ? 'vertical' : 'horizontal';
      }
      let classList = [Class.Node.COLOR_TARGET];
      if (groupNodeInfo.isFadedOut) {
        classList.push('faded-ellipse');
      }
      scene.selectOrCreateChild(shapeGroup, 'use', classList)
          .attr('xlink:href', '#op-series-' + stampType + '-stamp');
      scene.selectOrCreateChild(shapeGroup, 'rect', Class.Node.COLOR_TARGET)
          .attr({rx: d.radius, ry: d.radius});
      break;
    case NodeType.BRIDGE:
      scene.selectOrCreateChild(shapeGroup, 'rect', Class.Node.COLOR_TARGET)
          .attr({rx: d.radius, ry: d.radius});
      break;
    case NodeType.META:
      scene.selectOrCreateChild(shapeGroup, 'rect', Class.Node.COLOR_TARGET)
          .attr({rx: d.radius, ry: d.radius});
      break;
    default:
      throw Error('Unrecognized node type: ' + d.node.type);
  }
  return shapeGroup;
};

export function nodeClass(d: render.RenderNodeInfo) {
  switch (d.node.type) {
    case NodeType.OP:
      return Class.OPNODE;
    case NodeType.META:
      return Class.METANODE;
    case NodeType.SERIES:
      return Class.SERIESNODE;
    case NodeType.BRIDGE:
      return Class.BRIDGENODE;
    case NodeType.ELLIPSIS:
      return Class.ELLIPSISNODE;
  };
  throw Error('Unrecognized node type: ' + d.node.type);
};

/** Modify node and its subscene and its label's positional attributes */
function position(nodeGroup, d: render.RenderNodeInfo) {
  let shapeGroup = scene.selectChild(nodeGroup, 'g', Class.Node.SHAPE);
  let cx = layout.computeCXPositionOfNodeShape(d);
  switch (d.node.type) {
    case NodeType.OP: {
      // position shape
      let shape = scene.selectChild(shapeGroup, 'ellipse');
      scene.positionEllipse(shape, cx, d.y, d.coreBox.width, d.coreBox.height);
      labelPosition(nodeGroup, cx, d.y, d.labelOffset);
      break;
    }
    case NodeType.META: {
      // position shape
      let shape = scene.selectChild(shapeGroup, 'rect');
      if (d.expanded) {
        scene.positionRect(shape, d.x, d.y, d.width, d.height);
        subscenePosition(nodeGroup, d);
        // put label on top
        labelPosition(nodeGroup, cx, d.y,
          - d.height / 2 + d.labelHeight / 2);
      } else {
        scene.positionRect(shape, cx, d.y, d.coreBox.width, d.coreBox.height);
        labelPosition(nodeGroup, cx, d.y, 0);
      }
      break;
    }
    case NodeType.SERIES: {
      let shape = scene.selectChild(shapeGroup, 'use');
      if (d.expanded) {
        scene.positionRect(shape, d.x, d.y, d.width, d.height);
        subscenePosition(nodeGroup, d);
        // put label on top
        labelPosition(nodeGroup, cx, d.y,
          - d.height / 2 + d.labelHeight / 2);
      } else {
        scene.positionRect(shape, cx, d.y, d.coreBox.width, d.coreBox.height);
        labelPosition(nodeGroup, cx, d.y, d.labelOffset);
      }
      break;
    }
    case NodeType.BRIDGE: {
      // position shape
      // NOTE: In reality, these will not be visible, but it helps to put them id:2222
      // in the correct position for debugging purposes.
      let shape = scene.selectChild(shapeGroup, 'rect');
      scene.positionRect(shape, d.x, d.y, d.width, d.height);
      break;
    }
    default: { throw Error('Unrecognized node type: ' + d.node.type); }
  }
};

/** Enum specifying the options to color nodes by */
export enum ColorBy {STRUCTURE, DEVICE, XLA_CLUSTER, COMPUTE_TIME, MEMORY}
;

/**
 * Returns the fill color for the node given its state and the 'color by'
 * option.
 */
export function getFillForNode(templateIndex, colorBy,
    renderInfo: render.RenderNodeInfo, isExpanded: boolean): string {
  let colorParams = render.MetanodeColors;
  switch (colorBy) {
    case ColorBy.STRUCTURE:
      if (renderInfo.node.type === NodeType.META) {
        let tid = (<Metanode>renderInfo.node).templateId;
        return tid === null ?
          colorParams.UNKNOWN :
          colorParams.STRUCTURE_PALETTE(templateIndex(tid), isExpanded);
      } else if (renderInfo.node.type === NodeType.SERIES) {
        // If expanded, we're showing the background rect, which we want to
        // appear gray. Otherwise we're showing a stack of ellipses which we
        // want to show white.
        return isExpanded ? colorParams.EXPANDED_COLOR : 'white';
      } else if (renderInfo.node.type === NodeType.BRIDGE) {
        return renderInfo.structural ?
            '#f0e' :
            (<BridgeNode>renderInfo.node).inbound ? '#0ef' : '#fe0';
      } else {
        // Op nodes are white.
        return 'white';
      }
    case ColorBy.DEVICE:
      if (renderInfo.deviceColors == null) {
        // Return the hue for unknown device.
        return colorParams.UNKNOWN;
      }
      let id = renderInfo.node.name;
      let escapedId = tf.graph.util.escapeQuerySelector(id);
      let gradientDefs = d3.select('svg#svg defs #linearGradients');
      let linearGradient = gradientDefs.select('linearGradient#' + escapedId);
      // If the linear gradient is not there yet, create it.
      if (linearGradient.size() === 0) {
        linearGradient = gradientDefs.append('linearGradient').attr('id', id);
        // Re-create the stops of the linear gradient.
        linearGradient.selectAll('*').remove();
        let cumulativeProportion = 0;
        // For each device, create a stop using the proportion of that device.
        _.each(renderInfo.deviceColors, d => {
          let color = d.color;
          linearGradient.append('stop')
              .attr('offset', cumulativeProportion)
              .attr('stop-color', color);
          linearGradient.append('stop')
              .attr('offset', cumulativeProportion + d.proportion)
              .attr('stop-color', color);
          cumulativeProportion += d.proportion;
        });
      }
      return isExpanded ? colorParams.EXPANDED_COLOR : `url(#${escapedId})`;
    case ColorBy.XLA_CLUSTER:
      return isExpanded ? colorParams.EXPANDED_COLOR :
                          renderInfo.xlaClusterColor || colorParams.UNKNOWN;
    case ColorBy.COMPUTE_TIME:
      return isExpanded ?
        colorParams.EXPANDED_COLOR : renderInfo.computeTimeColor ||
        colorParams.UNKNOWN;
    case ColorBy.MEMORY:
      return isExpanded ?
        colorParams.EXPANDED_COLOR : renderInfo.memoryColor ||
        colorParams.UNKNOWN;
    default:
      throw new Error('Unknown case to color nodes by');
  }
}

/**
 * Modify node style by toggling class and assign attributes (only for things
 * that can't be done in css).
 */
export function stylize(nodeGroup, renderInfo: render.RenderNodeInfo,
    sceneElement, nodeClass?) {
  nodeClass = nodeClass || Class.Node.SHAPE;
  let isHighlighted = sceneElement.isNodeHighlighted(renderInfo.node.name);
  let isSelected = sceneElement.isNodeSelected(renderInfo.node.name);
  let isExtract = renderInfo.isInExtract || renderInfo.isOutExtract;
  let isExpanded = renderInfo.expanded;
  let isFadedOut = renderInfo.isFadedOut;
  nodeGroup.classed('highlighted', isHighlighted);
  nodeGroup.classed('selected', isSelected);
  nodeGroup.classed('extract', isExtract);
  nodeGroup.classed('expanded', isExpanded);
  nodeGroup.classed('faded', isFadedOut);

  // Main node always exists here and it will be reached before subscene,
  // so d3 selection is fine here.
  let node = nodeGroup.select('.' + nodeClass + ' .' + Class.Node.COLOR_TARGET);
  let fillColor = getFillForNode(sceneElement.templateIndex,
    ColorBy[sceneElement.colorBy.toUpperCase()],
    renderInfo, isExpanded);
  node.style('fill', fillColor);

  // Choose outline to be darker version of node color if the node is a single
  // color and is not selected.
  node.style('stroke', isSelected ? null : getStrokeForFill(fillColor));
};

/**
 * Given a node's fill color/gradient, determine the stroke for the node.
 */
export function getStrokeForFill(fill: string) {
  // If node is colored by a gradient, then use a dark gray outline.
  return fill.substring(0, 3) === 'url' ?
      render.MetanodeColors.GRADIENT_OUTLINE :
      d3.rgb(fill).darker().toString();
}

/**
 * Finds selected node and highlights all nodes which are providing direct
 * or indirect input to the node and all edges connecting these nodes
 * together and to the selected node.
 *
 * @param renderGraphInfo Information on the rendered state of the graph.
 */
export function traceInputs(renderGraphInfo: tf.graph.render.RenderGraphInfo) {
  // Reset all styling.
  d3.selectAll('.input-highlight').classed('input-highlight', false);
  d3.selectAll('.non-input').classed('non-input', false);
  d3.selectAll('.input-parent').classed('input-parent', false);
  d3.selectAll('.input-child').classed('input-child', false);
  d3.selectAll('.input-edge-highlight').classed('input-edge-highlight', false);
  d3.selectAll('.non-input-edge-highlight')
      .classed('non-input-edge-highlight', false);
  d3.selectAll('.input-highlight-selected')
      .classed('input-highlight-selected', false);

  // Extract currently selected node. Return if input tracing disabled or no
  // node is selected.
  let selectedNodeSelectorString = 'g.node.selected,g.op.selected';
  let node = d3.select(selectedNodeSelectorString);
  let currentNode = undefined;
  if (renderGraphInfo && renderGraphInfo.traceInputs && node && node[0] &&
      node[0][0]) {
    currentNode = node[0][0] as Element;
  } else {
    return;
  }
  let nodeName = currentNode.getAttribute('data-name');
  let opNodes = _getAllContainedOpNodes(nodeName, renderGraphInfo);
  let allTracedNodes = {};
  _.each(opNodes, function(nodeInstance) {
    allTracedNodes =
        traceAllInputsOfOpNode(renderGraphInfo, nodeInstance, allTracedNodes);
  });

  d3.selectAll(selectedNodeSelectorString).classed({
    // Remove the input-highlight from the selected node.
    'input-highlight': false,
    // Add input-highlight-selected class to selected node, which allows
    // treating the selected not as a special case of an input node.
    'input-highlight-selected': true
  });

  // Highlight all parent nodes of each OpNode as input parent to allow
  // specific highlighting.
  let highlightedNodes = Object.keys(allTracedNodes);
  let visibleNodes =
      _findVisibleParentsFromOpNodes(renderGraphInfo, highlightedNodes);
  _markParentsOfNodes(visibleNodes);

  // Attach class to all non-input nodes and edges for styling.
  d3.selectAll(
        'g.node:not(.selected):not(.input-highlight)' +
        ':not(.input-parent):not(.input-children)')
      .classed('non-input', true)
      .each(function(d: RenderNodeInfo) {
        // Mark all nodes with the specified name as non-inputs. This
        // results in Annotation nodes which are attached to inputs to be
        // tagged as well.
        let nodeName = d.node.name;
        d3.selectAll(`[data-name="${nodeName}"]`).classed('non-input', true);
      });
  d3.selectAll('g.edge:not(.input-edge-highlight)')
      .classed('non-input-edge-highlight', true);
}

/**
 * Recursively find all op nodes contained by the node identified by the
 * provided name.
 * @param nodeName The meta or op node of which the OpNode instances are
 * required.
 * @param renderGraphInfo The rendered graph information object.
 * @returns {Array} An array of OpNodeImpl instances.
 */
export function _getAllContainedOpNodes(
    nodeName: string, renderGraphInfo: tf.graph.render.RenderGraphInfo) {
  let opNodes = [];

  // Get current node.
  let node = renderGraphInfo.getNodeByName(nodeName) as tf.graph.GroupNode |
      tf.graph.OpNode;

  // If node is already OpNode then return the node plus its input embeddings.
  if (node instanceof tf.graph.OpNodeImpl) {
    return [node].concat(node.inEmbeddings);
  }

  // Otherwise, make recursive call for each node contained by the GroupNode.
  let childNodeNames = (node as tf.graph.GroupNode).metagraph.nodes();
  _.each(childNodeNames, function(childNodeName) {
    opNodes =
        opNodes.concat(_getAllContainedOpNodes(childNodeName, renderGraphInfo));
  });

  return opNodes;
}

/**
 * When resolving inputs of a node the visible parent node of each input
 * node (i.e. the first parent which is rendered to the screen) needs to be
 * found, and since such a node may contain several input OpNodes a map
 * of the visible parent to all the input OpNodes it contains is provided by
 * opNodes.
 */
interface VisibleParent {
  visibleParent: Node;
  opNodes: OpNode[];
}

export function traceAllInputsOfOpNode(
    renderGraphInfo: tf.graph.render.RenderGraphInfo, startNode: OpNode,
    allTracedNodes: Object) {
  // To prevent infinite loops due to cyclical relationships and improving
  // performance by tracing OpNode which is input to 2+ nodes only once.
  if (allTracedNodes[startNode.name]) {
    return allTracedNodes;
  } else {
    allTracedNodes[startNode.name] = true;
  }
  // Extract the inputs.
  let inputs = startNode.inputs;
  // Get visible parent.
  let currentVisibleParent = getVisibleParent(renderGraphInfo, startNode);
  // Mark as input node.
  d3.select(`.node[data-name="${currentVisibleParent.name}"]`)
      .classed('input-highlight', true);

  // Find the visible parent of each input.
  let visibleInputs = {};
  _.each(inputs, function(nodeInstance) {
    let resolvedNode = renderGraphInfo.getNodeByName(nodeInstance.name);
    if (resolvedNode === undefined) {
      // Node could not be found in rendered Hierarchy, which happens when
      // tracing inputs of a SummaryNode.
      return;
    }
    // Ensure node is resolved to OpNode if name collision with Metanode exists.
    if (resolvedNode instanceof MetanodeImpl) {
      let resolvedNodeName = tf.graph.getStrictName(resolvedNode.name);
      resolvedNode = renderGraphInfo.getNodeByName(resolvedNodeName) as OpNode;
    }

    let visibleParent = getVisibleParent(renderGraphInfo, resolvedNode);

    // Append OpNode to visible parent entry.
    let visibleInputsEntry = visibleInputs[visibleParent.name];
    if (visibleInputsEntry) {
      visibleInputsEntry.opNodes.push(resolvedNode);
    } else {  // Create new entry.
      visibleInputs[visibleParent.name] = {
        visibleParent: visibleParent,
        opNodes: [resolvedNode]
      } as VisibleParent;
    }
  });

  // Find all parents of the start node.
  let startNodeParents = {};
  let indexedStartNodeParents = [currentVisibleParent];
  startNodeParents[currentVisibleParent.name] = {
    traced: false,
    index: 0,
    connectionEndpoints: []
  };

  let currentNode = currentVisibleParent as Node;
  for (let index = 1; currentNode.name !== tf.graph.ROOT_NAME; index++) {
    currentNode = currentNode.parentNode;
    startNodeParents[currentNode.name] = {
      traced: false,
      index: index,
      connectionEndpoints: []
    };
    indexedStartNodeParents[index] = currentNode;
  }

  // Find first mutual parent of each input node and highlight connection.
  _.forOwn(visibleInputs, function(visibleParentInfo: VisibleParent, key) {
    let nodeInstance = visibleParentInfo.visibleParent;
    // Make recursive call for each input-OpNode contained by the visible
    // parent.
    _.each(visibleParentInfo.opNodes, function(opNode: OpNode) {
      allTracedNodes =
          traceAllInputsOfOpNode(renderGraphInfo, opNode, allTracedNodes);
    });

    if (nodeInstance.name !== currentVisibleParent.name) {
      _createVisibleTrace(
          nodeInstance, startNodeParents, indexedStartNodeParents);
    }
  });

  return allTracedNodes;
}

/**
 * Colors the edges to connect the passed node to the start node. This is
 * done by:
 *
 * a) Finding the first (visible) common parent in the rendered
 * hierarchy.
 * NB: There are 2 types of connections:
 * 1) Direct connections between node A
 * and B, marked below as II,
 * 2) Connections from any node A to its parent, A'. Marked below as I and III.
 * For type 2 connection you need to know the inner-nested node, the
 * direct parent, and the ultimate destination of the connection.
 *
 *  A_parent      B_parent
 * +--------+    +---------+
 * |        |    |         |
 * |  +--+ I| II |III+--+  |
 * |  |A +---------->+B |  |
 * |  +--+  |    |   +--+  |
 * |        |    |         |
 * +--------+    +---------+
 *
 *
 * b) Highlighting the direct connection between the parents of A and B,
 * called A_parent and B_parent, s.t. A_parent and B_parent are children of the
 * mutual parent of A and B found in a), marked above as II.
 *
 * c) Highlighting the connection from A to A_parent and B to B_parent
 * (through all layers of parents between A and A_parent and B and B_parent,
 * respectively). Marked above as I and III.
 *
 * @param nodeInstance The instance of the node to use as destination node, B.
 * @param startNodeParents Map of startNodeParent names to information objects
 * about the parent.
 * @param indexedStartNodeParents An array of all parents of the start node.
 * This is required to find the child of the mutual parent which is a parent
 * of the start node.
 * @private
 */
function _createVisibleTrace(
    nodeInstance: Node, startNodeParents, indexedStartNodeParents: Node[]) {
  let currentNode = nodeInstance;
  let previousNode = nodeInstance;

  // Ascend through parents until a mutual parent is found with the start
  // node.
  let destinationParentPairs = [];
  while (!startNodeParents[currentNode.name]) {
    if (previousNode.name !== currentNode.name) {
      destinationParentPairs.push([previousNode, currentNode]);
    }
    previousNode = currentNode;
    currentNode = currentNode.parentNode;
  }

  // Connection between nodes is drawn between the parents of each
  // respective node, both of which share the mutual parent.
  let startNodeIndex = startNodeParents[currentNode.name].index;
  let startNodeName =
      indexedStartNodeParents[Math.max(startNodeIndex - 1, 0)].name;

  let startNodeTopParentName = startNodeName;
  let targetNodeTopParentName = previousNode.name;

  let endNodeName = previousNode.name;
  d3.selectAll(`[data-edge="${endNodeName}--${startNodeName}"]`)
      .classed('input-edge-highlight', true);

  // Trace up the parents of the input.
  _.each(destinationParentPairs, function(value) {
    let inner = value[0];
    let outer = value[1];
    let edgeSelector = `[data-edge="${inner.name}--${startNodeTopParentName}` +
        `~~${outer.name}~~OUT"]`;
    d3.selectAll(edgeSelector).classed('input-edge-highlight', true);
  });

  // Trace up the parents of the start node.
  for (let index = 1; index < startNodeIndex; index++) {
    let inner = indexedStartNodeParents[index - 1];
    let outer = indexedStartNodeParents[index];
    let edgeSelector = `[data-edge="${targetNodeTopParentName}~~${outer.name}` +
        `~~IN--${inner.name}"]`;
    d3.selectAll(edgeSelector).classed('input-edge-highlight', true);
  }
}

/**
 * Creates map { [name: string] -> Node } of all visible / rendered parents
 * of the nodes identified by the node names passed in.
 *
 * @param renderGraphInfo The information on the rendered graph.
 * @param nodeNames String array of node names.
 * @returns {[nodeName: string]: Node}
 * @private
 */
function _findVisibleParentsFromOpNodes(renderGraphInfo, nodeNames: string[]) {
  let visibleParents: {[nodeName: string]: Node} = {};
  _.each(nodeNames, function(nodeName) {
    let currentNode = renderGraphInfo.getNodeByName(nodeName);
    let visibleParent = getVisibleParent(renderGraphInfo, currentNode);
    visibleParents[visibleParent.name] = visibleParent;
  });

  return visibleParents;
}

/**
 * Traverse through the parents of all nodes in the list and mark each
 * encountered node as input-parent.
 * @param visibleNodes Map of input nodes, have to be visible/rendered when
 * called.
 * @private
 */
function _markParentsOfNodes(visibleNodes: {[nodeName: string]: Node}) {
  _.forOwn(visibleNodes, function(nodeInstance: Node) {
    // Mark all parents of the node as input-parents.
    let currentNode = nodeInstance;

    while (currentNode.name !== tf.graph.ROOT_NAME) {
      let renderedElement = d3.select(`.node[data-name="${currentNode.name}"]`);
      // Only mark the element as a parent node to an input if it is not
      // marked as input node itself.
      if (renderedElement[0][0] &&
          !renderedElement.classed('input-highlight') &&
          !renderedElement.classed('selected') &&
          // OpNode only parent if start node is embedded node, in which case
          // the OpNode should be faded as well.
          !renderedElement.classed('op')) {
        renderedElement.classed('input-parent', true);
      }
      currentNode = currentNode.parentNode;
    }
  });
}

/**
 * Find the parent of the passed in op node which is expanded. This is done
 * by going through all parents until the parent's parent is expanded, thus
 * finding the first unexpanded parent which is rendered on the screen.
 * @param renderGraphInfo The graph info object used to gain access to the
 * render info of the parents.
 * @param currentNode The node whose parent is to be found.
 * @returns Node
 */
export function getVisibleParent(
    renderGraphInfo: tf.graph.render.RenderGraphInfo,
    currentNode: tf.graph.Node) {
  let found = false;
  let currentParent = currentNode;

  while (!found) {
    // Get parent element, to extract name.
    currentNode = currentParent;
    currentParent = currentNode.parentNode;

    if (currentParent === undefined) {
      found = true;
    } else {
      let renderNode = renderGraphInfo.getRenderNodeByName(currentParent.name);
      // Found if node is rendered on the screen (renderNode truthy), and
      // the parent is either expanded (i.e. it is a metanode or seriesnode)
      // or the parent is an OpNode in which case currentNode is an embedded
      // node which has another OpNode as parent.
      if (renderNode &&
          (renderNode.expanded || currentParent instanceof graph.OpNodeImpl)) {
        found = true;
      }
    }
  }  // Close while loop.
  return currentNode;
}
}  // Close module.
