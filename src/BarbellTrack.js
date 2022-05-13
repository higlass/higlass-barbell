import { TextManager, MAX_TEXTS, TEXT_STYLE } from './TextManager.js';
import classifyPoint from 'robust-point-in-polygon';

const MAX_TILE_ENTRIES = 5000;
const GENE_RECT_HEIGHT = 16;

/** Scale a polygon * */
export const polyToPoly = (poly, kx, px, ky, py) => {
  const newArr = [];

  while (poly.length) {
    const [x, y] = poly.splice(0, 2);
    newArr.push([x * kx + px, y * ky + py]);
  }

  return newArr;
};

const hashFunc = function (s) {
  let hash = 0;
  if (s.length === 0) {
    return hash;
  }
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash &= hash; // Convert to 32bit integer
  }
  return hash;
};

const scaleScalableGraphics = (graphics, xScale, drawnAtScale) => {
  if (!graphics) return;

  const tileK =
    (drawnAtScale.domain()[1] - drawnAtScale.domain()[0]) /
    (xScale.domain()[1] - xScale.domain()[0]);
  const newRange = xScale.domain().map(drawnAtScale);

  const posOffset = newRange[0];
  graphics.scale.x = tileK;
  graphics.position.x = -posOffset * tileK;
};

export const uniqueify = (elements) => {
  const byUid = {};
  for (let i = 0; i < elements.length; i++) {
    byUid[elements[i].uid] = elements[i];
  }

  return Object.values(byUid);
};

export default function BarbellTrack(HGC, ...args) {
  if (!new.target) {
    throw new Error(
      'Uncaught TypeError: Class constructor cannot be invoked without "new"'
    );
  }

  // const { PIXI } = HGC.libraries;
  // const { scaleLinear, scaleLog } = HGC.libraries.d3Scale;

  const { scaleBand, scaleLinear } = HGC.libraries.d3Scale;
  const { median, range } = HGC.libraries.d3Array;
  const { zoomIdentity } = HGC.libraries.d3Zoom;
  const { tileProxy } = HGC.services;
  const { HEATED_OBJECT_MAP } = HGC.configs;
  const PIXI = HGC.libraries.PIXI;
  const {
    valueToColor,
    colorToHex,
    segmentsToRows,
    colorDomainToRgbaArray,
  } = HGC.utils;

  /**
   * A track has received an event telling it to zoom along its
   * vertical axis. Update the transform describing the position
   * of its graphics.
   *
   * @param  {number} yPos        The position the zoom event took place
   * @param  {number} kMultiplier How much the zoom level should be adjusted by
   * @param  {d3.transform} transform   The track's current graphics transform.
   * @param  {number} height      The height of the track
   * @return {d3.transform}            The track's new graphics transform.
   */
  const zoomedY = (yPos, kMultiplier, transform, height) => {
    const k0 = transform.k;
    const t0 = transform.y;
    const dp = (yPos - t0) / k0;
    const k1 = Math.max(k0 / kMultiplier, 1.0);
    let t1 = k0 * dp + t0 - k1 * dp;

    // clamp at the bottom
    t1 = Math.max(t1, -(k1 - 1) * height);

    // clamp at the top
    t1 = Math.min(t1, 0);
    // right now, the point at position 162 is at position 0
    // 0 = 1 * 162 - 162
    //
    // we want that when k = 2, that point is still at position
    // 0 = 2 * 162 - t1
    //  ypos = k0 * dp + t0
    //  dp = (ypos - t0) / k0
    //  nypos = k1 * dp + t1
    //  k1 * dp + t1 = k0 * dp + t0
    //  t1 = k0 * dp +t0 - k1 * dp
    return zoomIdentity.translate(0, t1).scale(k1);
  };

  const renderBarbell = (td, graphics, track, selected, strand) => {
    const geneInfo = td.fields;
    let { row, fill } = td;

    // the returned positions are chromosome-based and they need to
    // be converted to genome-based
    const xChrOffset = +td.xChrOffset;
    const yChrOffset = +td.yChrOffset;
    const xTxStart = +geneInfo[1] + xChrOffset;
    const xTxEnd = +geneInfo[2] + xChrOffset;
    const yTxStart = +geneInfo[4] + yChrOffset;
    const yTxEnd = +geneInfo[5] + yChrOffset;
    const txMiddle = (xTxStart + yTxEnd) / 2;

    let yMiddle = track.getRowScale(strand)(row) + track.getRowScale(strand).bandwidth() / 2;

    let rectHeight = track.options.annotationHeight || 'scaled';

    if (rectHeight === 'scaled') {
      rectHeight = track.getRowScale(strand).bandwidth();

      if (track.options.maxAnnotationHeight) {
        rectHeight = Math.min(rectHeight, +track.options.maxAnnotationHeight);
      }
    }

    if (
      track.options &&
      track.options.colorEncoding === 'itemRgb' &&
      td.fields[8]
    ) {
      const parts = td.fields[8].split(',');

      if (parts.length === 3) {
        const color = `rgb(${td.fields[8]})`;

        fill = color;
      }
    } else if (track.colorValueScale) {
      const rgb = valueToColor(
        track.colorValueScale,
        track.colorScale,
        0, // pseudocounts
        -Number.MIN_VALUE
      )(+geneInfo[+track.options.colorEncoding - 1]);
      fill = `rgba(${rgb.join(',')})`;
    }

    if (track.valueScale) {
      const value = +geneInfo[+track.options.valueColumn - 1];
      if (value > this.maxValue) {
        this.maxValue = value;
      }
      yMiddle = track.valueScale(value);
    }

    const opacity = track.options.fillOpacity || 0.3;

    if (selected || track.selectedRect === td.uid) {
      graphics.lineStyle(3, 0, 0.75);
    } else {
      graphics.lineStyle(1, colorToHex(fill), opacity);
    }

    graphics.beginFill(colorToHex(fill), opacity);

    let rectY = yMiddle - rectHeight / 2;
    const xStartPos = track._xScale(xTxStart);
    const xEndPos = track._xScale(xTxEnd);

    const yStartPos = track._xScale(yTxStart);
    const yEndPos = track._xScale(yTxEnd);


    // draw the left end of the barbell
    const xDrawnPoly = track.drawPoly(
      graphics,
      xStartPos,
      xEndPos,
      rectY * track.prevK,
      rectHeight * track.prevK,
      geneInfo[5]
    );

    // draw the middle line connecting the two
    const mDrawnPoly = track.drawPoly(
      graphics,
      xEndPos,
      yStartPos,
      (rectY + rectHeight / 2) * track.prevK,

      1,
      geneInfo[5]
    );

    // draw the right end of the barbell
    const yDrawnPoly = track.drawPoly(
      graphics,
      yStartPos,
      yEndPos,
      rectY * track.prevK,
      rectHeight * track.prevK,
      geneInfo[5]
    );

    track.drawnRects[td.uid + '_x'] = [
      xDrawnPoly,
      {
        start: xTxStart,
        end: xTxEnd,
        value: td,
        fill,
        strand
      },
    ];

    track.drawnRects[td.uid + '_m'] = [
      mDrawnPoly,
      {
        start: xTxEnd,
        end: yTxStart,
        value: td,
        fill,
        strand
      },
    ];

    track.drawnRects[td.uid + '_y'] = [
      yDrawnPoly,
      {
        start: yTxStart,
        end: yTxEnd,
        value: td,
        fill,
        strand
      },
    ];

    if (!track.options.showTexts) {
      return;
    }

    // don't draw too many texts so they don't bog down the frame rate
    if (track.textsDrawn >= (+track.options.maxTexts || MAX_TEXTS)) return;

    track.textsDrawn += 1;

    track.textManager.updateSingleText(
      td,
      track._xScale(txMiddle),
      rectY + rectHeight / 2,
      td.fields[3]
    );
  };

  class BarbellTrackClass extends HGC.tracks.HorizontalTiled1DPixiTrack {
    constructor(context, options) {
      super(context, options);

      this.valueScaleTransform = zoomIdentity;

      this.vertY = 0;
      this.vertK = 1;
      this.prevY = 0;
      this.prevK = 1;

      this.initGraphics();

      // we're setting these functions to null so that value scale
      // locking doesn't try to get values from them
      this.minRawValue = null;
      this.maxRawValue = null;

      this.hovered = null;

      this.selectedRect = null;
      this.uniqueSegments = [];
    }

    getTextManager() {
      if (!this.textManager) {
        this.textManager = new TextManager(this, HGC);
      }

      return this.textManager;
    }

    getRowScale(strand) {
      if (!this.rowScale) {
        this.rowScale = {}
      }

      if (strand) {
        return this.rowScale[strand];
      }
      
      return this.rowScale;
    }

    initGraphics() {
      this.rectGraphics = new PIXI.Graphics();
      this.mouseOverGraphics = new PIXI.Graphics();

      this.pMain.addChild(this.rectGraphics);
      this.pMain.addChild(this.mouseOverGraphics);
    }

    getMouseOverGraphics() {
      if (!this.mouseOverGraphics) {
        this.initGraphics();
      }

      return this.mouseOverGraphics
    }
    /** Factor out some initialization code for the track. This is
   necessary because we can now load tiles synchronously and so
   we have to check if the track is initialized in renderTiles
   and not in the constructor */
    initialize() {
      if (this.initialized) return;

      [this.prevK, this.vertK, this.vertY] = [1, 1, 0];

      if (!this.drawnRects) {
        this.drawnRects = {};
      }

      if (!this.colorScale) {
        if (this.options.colorRange) {
          this.colorScale = colorDomainToRgbaArray(this.options.colorRange);
        } else {
          this.colorScale = HEATED_OBJECT_MAP;
        }
      }

      this.initialized = true;
    }

    updateExistingGraphics() {
      const errors = this.checkForErrors();

      let plusStrandRows = [];
      let minusStrandRows = [];

      if (errors.length > 0) {
        this.draw();
        return;
      }

      this.uniqueSegments = uniqueify(
        Object.values(this.fetchedTiles)
          .map((x) => x.tileData)
          .flat()
      );

      this.uniqueSegments.forEach((td) => {
        // A random importance helps with selective hiding
        // of overlapping texts
        if (!td.importance) {
          td.importance = hashFunc(td.uid.toString());
        }
      });

      this.uniqueSegments.sort((a, b) => b.importance - a.importance);

      if (!this.options || !this.options.valueColumn) {
        // no value column so we can break entries up into separate
        // plus and minus strand segments
        const segments = this.uniqueSegments.map((x) => {
          const chrOffset = +x.xChrOffset;

          return {
            from: +x.fields[1] + chrOffset,
            to: +x.fields[5] + chrOffset,
            value: x,
            text: x.fields[6],
            strand: x.fields.length >= 6 && x.fields[7] === '-' ? '-' : '+',
          };
        });

        plusStrandRows = segmentsToRows(
          segments.filter((x) => x.strand === '+')
        );
        minusStrandRows = segmentsToRows(
          segments.filter((x) => x.strand === '-')
        );
      } else {
        plusStrandRows = [this.uniqueSegments.map((x) => ({ value: x }))];
      }

      this.plusStrandRows = plusStrandRows;
      this.minusStrandRows = minusStrandRows;

      this.getTextManager().updateTexts();

      this.render();

      this.rectGraphics.interactive = true;
      this.rectGraphics.mouseup = e => clickFunc(e, this);
    }

    /** There was a click outside the track so unselect the
     * the current selection */
    clickOutside() {
      this.selectRect(null);
    }

    initTile(/* tile */) {}

    destroyTile(/* tile */) {}

    removeTiles(toRemoveIds) {
      super.removeTiles(toRemoveIds);

      // Pete: we're going to rerender after destroying tiles to make sure
      // any rectangles that were listed under 'drawnRects' don't get
      // ignored
      // Fritz: this line is causing unnecessary rerenderings. Seems to work fine
      // without rerendering anyway, so I disabled it.
      // if (toRemoveIds.length > 0) this.rerender(this.options);
    }

    drawTile(/* tile */) {
      if (this.options && this.options.valueColumn) {
        // there might no be a value scale if no valueColumn was specified
        if (this.valueScale) this.drawAxis(this.valueScale);
      }
    }

    rerender(options, force) {
      super.rerender(options, force);

      // this will get instantiated if a value column is specified
      this.valueScale = null;
      this.drawnRects = {};

      if (this.options.colorRange) {
        this.colorScale = colorDomainToRgbaArray(this.options.colorRange);
      } else {
        this.colorScale = HEATED_OBJECT_MAP;
      }

      this.updateExistingGraphics();
    }

    updateTile(/* tile */) {
      // this.destroyTile(tile);
      // if (this.areAllVisibleTilesLoaded()) {
      //   this.destroyTile(tile);
      //   this.initTile(tile);
      //   this.renderTile(tile);
      // }
    }

    /**
     * Use this only when there's one row
     *
     * @return {[type]} [description]
     */
    allVisibleRects() {
      const allRects = {};

      Object.values(this.fetchedTiles).forEach((x) => {
        if (!x.plusStrandRows) return;

        for (const row of x.plusStrandRows[0]) {
          if (!allRects[row.value.uid]) {
            allRects[row.value.uid] = row;
          }
        }
      });

      return allRects;
    }

    checkForErrors() {
      const errors = Object.values(this.fetchedTiles)
        .map(
          (x) =>
            x.tileData && x.tileData.error && `${x.tileId}: ${x.tileData.error}`
        )
        .filter((x) => x);

      if (errors.length) {
        this.errorTextText = errors.join('\n');
      } else {
        this.errorTextText = '';
      }

      if (this.tilesetInfoError) {
        this.errorTextText = this.tilesetInfoError;

        errors.push(this.tilesetInfoError);
      }

      return errors;
    }

    drawPoly(graphics, xStartPos, xEndPos, rectY, rectHeight, strand) {
      let drawnPoly = null;

      if (
        (strand === '+' || strand === '-') &&
        xEndPos - xStartPos < GENE_RECT_HEIGHT / 2
      ) {
        // only draw if it's not too wide
        drawnPoly = [
          xStartPos,
          rectY, // top
          xStartPos + rectHeight / 2,
          rectY + rectHeight / 2, // right point
          xStartPos,
          rectY + rectHeight, // bottom
        ];

        if (strand === '+') {
          graphics.drawPolygon(drawnPoly);
        } else {
          drawnPoly = [
            xEndPos,
            rectY, // top
            xEndPos - rectHeight / 2,
            rectY + rectHeight / 2, // left point
            xEndPos,
            rectY + rectHeight, // bottom
          ];
          graphics.drawPolygon(drawnPoly);
        }
      } else {
        if (strand === '+') {
          drawnPoly = [
            xStartPos,
            rectY, // left top
            xEndPos - rectHeight / 2,
            rectY, // right top
            xEndPos,
            rectY + rectHeight / 2,
            xEndPos - rectHeight / 2,
            rectY + rectHeight, // right bottom
            xStartPos,
            rectY + rectHeight, // left bottom
          ];
        } else if (strand === '-') {
          drawnPoly = [
            xStartPos + rectHeight / 2,
            rectY, // left top
            xEndPos,
            rectY, // right top
            xEndPos,
            rectY + rectHeight, // right bottom
            xStartPos + rectHeight / 2,
            rectY + rectHeight, // left bottom
            xStartPos,
            rectY + rectHeight / 2,
          ];
        } else {
          drawnPoly = [
            xStartPos,
            rectY, // left top
            xEndPos,
            rectY, // right top
            xEndPos,
            rectY + rectHeight, // right bottom
            xStartPos,
            rectY + rectHeight, // left bottom
          ];
        }

        graphics.drawPolygon(drawnPoly);
      }

      return drawnPoly;
    }

    /** The value scale is used to arrange annotations vertically
      based on a value */
    setValueScale() {
      this.valueScale = null;

      if (this.options && this.options.valueColumn) {
        /**
         * These intervals come with some y-value that we want to plot
         */

        const min = this.options.colorEncodingRange
          ? +this.options.colorEncodingRange[0]
          : this.minVisibleValueInTiles(+this.options.valueColumn);
        const max = this.options.colorEncodingRange
          ? +this.options.colorEncodingRange[1]
          : this.maxVisibleValueInTiles(+this.options.valueColumn);

        if (this.options.valueColumn) {
          [this.valueScale] = this.makeValueScale(
            min,
            this.calculateMedianVisibleValue(+this.options.valueColumn),
            max
          );
        }
      }
    }

    /** The color value scale is used to map some value to a coloring */
    setColorValueScale() {
      this.colorValueScale = null;

      if (
        this.options &&
        this.options.colorEncoding &&
        this.options.colorEncoding !== 'itemRgb'
      ) {
        const min = this.options.colorEncodingRange
          ? +this.options.colorEncodingRange[0]
          : this.minVisibleValueInTiles(+this.options.colorEncoding);
        const max = this.options.colorEncodingRange
          ? +this.options.colorEncodingRange[1]
          : this.maxVisibleValueInTiles(+this.options.colorEncoding);

        this.colorValueScale = scaleLinear().domain([min, max]).range([0, 255]);
      }
    }

    renderRows(rows, maxRows, startY, endY, fill, strand) {
      this.maxValue = Number.MIN_SAFE_INTEGER;

      this.initialize();

      this.getRowScale()[strand] = scaleBand().domain(range(maxRows)).range([startY, endY]);
      // .paddingOuter(0.2);
      // .paddingInner(0.3)

      this.allVisibleRects();
      this.textsDrawn = 0;

      for (let j = 0; j < rows.length; j++) {
        for (let i = 0; i < rows[j].length; i++) {
          // rendered += 1;
          const td = rows[j][i].value;
          td.row = j;
          td.fill = fill;

          renderBarbell(td, this.rectGraphics, this, false, strand);
        }
      }

      // this.textManager may be null when using local tiles because
      // the tilesetInfo callback will be called synchronously in the
      // parent track's constructor
      this.getTextManager().updateTexts();
    }

    render() {
      const maxPlusRows = this.plusStrandRows ? this.plusStrandRows.length : 1;
      const maxMinusRows = this.minusStrandRows
        ? this.minusStrandRows.length
        : 1;

      this.prevVertY = this.vertY;

      const oldRectGraphics = this.rectGraphics;
      this.rectGraphics = new PIXI.Graphics();

      // store the scale at while the tile was drawn at so that
      // we only resize it when redrawing

      this.drawnAtScale = this._xScale.copy();
      // configure vertical positioning of annotations if
      // this.options.valueColumn is set
      this.setValueScale();

      // configure coloring of annotations if
      // this.options.colorEncoding is set
      this.setColorValueScale();

      const fill =
        this.options.plusStrandColor || this.options.fillColor || 'blue';
      const minusStrandFill =
        this.options.minusStrandColor || this.options.fillColor || 'purple';

      const MIDDLE_SPACE = 0;
      let plusHeight = 0;

      if (this.options.separatePlusMinusStrands) {
        plusHeight =
          (maxPlusRows * this.dimensions[1]) / (maxPlusRows + maxMinusRows) -
          MIDDLE_SPACE / 2;
      } else {
        plusHeight = this.dimensions[1];
      }

      this.renderRows(this.plusStrandRows, maxPlusRows, 0, plusHeight, fill, '+');
      this.renderRows(
        this.minusStrandRows,
        maxMinusRows,
        this.options.separatePlusMinusStrands
          ? plusHeight + MIDDLE_SPACE / 2
          : 0,
        this.dimensions[1],
        minusStrandFill,
        '-'
      );

      this.pMain.removeChild(oldRectGraphics);
      this.pMain.addChild(this.rectGraphics);

      scaleScalableGraphics(this.rectGraphics, this._xScale, this.drawnAtScale);
      scaleScalableGraphics(
        this.getMouseOverGraphics(),
        this._xScale,
        this.drawnAtScale
      );
      // scaleScalableGraphics(this.textGraphics, this._xScale, this.drawnAtScale);
    }

    calculateZoomLevel() {
      // offset by 2 because 1D tiles are more dense than 2D tiles
      // 1024 points per tile vs 256 for 2D tiles
      const xZoomLevel = tileProxy.calculateZoomLevel(
        this._xScale,
        this.tilesetInfo.min_pos[0],
        this.tilesetInfo.max_pos[0]
      );

      let zoomLevel = Math.min(xZoomLevel, this.maxZoom);
      zoomLevel = Math.max(zoomLevel, 0);

      return zoomLevel;
    }

    minVisibleValueInTiles(valueColumn) {
      let visibleAndFetchedIds = this.visibleAndFetchedIds();

      if (visibleAndFetchedIds.length === 0) {
        visibleAndFetchedIds = Object.keys(this.fetchedTiles);
      }

      let min = Math.min.apply(
        null,
        visibleAndFetchedIds
          .map((x) => this.fetchedTiles[x])
          .filter((x) => x.tileData && x.tileData.length)
          .map((x) =>
            Math.min.apply(
              null,
              x.tileData
                .sort((a, b) => b.importance - a.importance)
                .slice(0, MAX_TILE_ENTRIES)
                .map((y) => +y.fields[valueColumn - 1])
                .filter((y) => !Number.isNaN(y))
            )
          )
      );

      // if there's no data, use null
      if (min === Number.MAX_SAFE_INTEGER) {
        min = null;
      }

      return min;
    }

    maxVisibleValueInTiles(valueColumn) {
      let visibleAndFetchedIds = this.visibleAndFetchedIds();

      if (visibleAndFetchedIds.length === 0) {
        visibleAndFetchedIds = Object.keys(this.fetchedTiles);
      }

      let max = Math.max.apply(
        null,
        visibleAndFetchedIds
          .map((x) => this.fetchedTiles[x])
          .filter((x) => x.tileData && x.tileData.length)
          .map((x) =>
            Math.max.apply(
              null,
              x.tileData
                .sort((a, b) => b.importance - a.importance)
                .slice(0, MAX_TILE_ENTRIES)
                .map((y) => +y.fields[valueColumn - 1])
                .filter((y) => !Number.isNaN(y))
            )
          )
      );

      // if there's no data, use null
      if (max === Number.MIN_SAFE_INTEGER) {
        max = null;
      }

      return max;
    }

    calculateMedianVisibleValue(valueColumn) {
      if (this.areAllVisibleTilesLoaded()) {
        this.allTilesLoaded();
      }

      let visibleAndFetchedIds = this.visibleAndFetchedIds();

      if (visibleAndFetchedIds.length === 0) {
        visibleAndFetchedIds = Object.keys(this.fetchedTiles);
      }

      const values = []
        .concat(
          ...visibleAndFetchedIds
            .map((x) => this.fetchedTiles[x])
            .filter((x) => x.tileData && x.tileData.length)
            .map((x) =>
              x.tileData
                .sort((a, b) => b.importance - a.importance)
                .slice(0, MAX_TILE_ENTRIES)
                .map((y) => +y.fields[valueColumn - 1])
            )
        )
        .filter((x) => x > 0);

      this.medianVisibleValue = median(values);
    }

    draw() {
      super.draw();

      // this.textManager may be null when using local tiles because
      // the tilesetInfo callback will be called synchronously in the
      // parent track's constructor
        this.getTextManager().startDraw();

      // these values control vertical scaling and they
      // need to be set in the draw method otherwise when
      // the window is resized, the zoomedY method won't
      // be called
      this.rectGraphics.scale.y = this.vertK;
      this.rectGraphics.position.y = this.vertY;

      this.getMouseOverGraphics().scale.y = this.vertK;
      this.getMouseOverGraphics().position.y = this.vertY;

      // hasn't been rendered yet
      if (!this.drawnAtScale) {
        return;
      }

      scaleScalableGraphics(this.rectGraphics, this._xScale, this.drawnAtScale);
      scaleScalableGraphics(
        this.getMouseOverGraphics(),
        this._xScale,
        this.drawnAtScale
      );
      // scaleScalableGraphics(this.textGraphics, this._xScale, this.drawnAtScale);

      if (this.uniqueSegments && this.uniqueSegments.length) {
        this.uniqueSegments.forEach((td) => {
          const geneInfo = td.fields;
          const geneName = geneInfo[3];
          const xChrOffset = +td.xChrOffset;
          const yChrOffset = +td.yChrOffset;

          const xTxStart = +geneInfo[1] + xChrOffset;
          const yTxEnd = +geneInfo[5] + yChrOffset;
          const txMiddle = (xTxStart + yTxEnd) / 2;

          const xMiddle = this._xScale(txMiddle);
          if (this.getTextManager().texts[td.uid]) {
            const yMiddle =
              this.getTextManager().texts[td.uid].nominalY *
                (this.vertK * this.prevK) +
              this.vertY;

            this.getTextManager().lightUpdateSingleText(td, xMiddle, yMiddle, {
              importance: td.importance,
              caption: geneName,
              strand: geneInfo[5],
            });
          }
        });
      }

        this.getTextManager().hideOverlaps();
    }

    setPosition(newPosition) {
      super.setPosition(newPosition);

      [this.pMain.position.x, this.pMain.position.y] = this.position;
      this.rerender(this.options);
    }

    setDimensions(newDimensions) {
      super.setDimensions(newDimensions);
    }

    zoomed(newXScale, newYScale) {
      this.xScale(newXScale);
      this.yScale(newYScale);

      this.refreshTiles();

      this.draw();
    }

    exportSVG() {
      let track = null;
      let base = null;

      if (super.exportSVG) {
        [base, track] = super.exportSVG();
      } else {
        base = document.createElement('g');
        track = base;
      }
      const output = document.createElement('g');
      output.setAttribute(
        'transform',
        `translate(${this.position[0]},${this.position[1]})`
      );

      track.appendChild(output);
      const rectOutput = document.createElement('g');
      const textOutput = document.createElement('g');

      output.appendChild(rectOutput);
      output.appendChild(textOutput);

      this.uniqueSegments.forEach((td) => {
        const gTile = document.createElement('g');
        gTile.setAttribute(
          'transform',
          `translate(${this.rectGraphics.position.x},${this.rectGraphics.position.y})scale(${this.rectGraphics.scale.x},${this.rectGraphics.scale.y})`
        );
        rectOutput.appendChild(gTile);

        for (let rectType of ['x', 'y', 'm']) {
          const rectUid = `${td.uid}_${rectType}`;
          if (this.drawnRects && rectUid in this.drawnRects) {
            const rect = this.drawnRects[rectUid][0];
            const r = document.createElement('path');
            let d = `M ${rect[0]} ${rect[1]}`;

            for (let i = 2; i < rect.length; i += 2) {
              d += ` L ${rect[i]} ${rect[i + 1]}`;
            }

            const fill = this.drawnRects[rectUid][1].fill;
            const fontColor =
              this.options.fontColor !== undefined
                ? colorToHex(this.options.fontColor)
                : fill;

            r.setAttribute('d', d);
            r.setAttribute('fill', fill);
            r.setAttribute('opacity', 0.3);

            r.style.stroke = fill;
            r.style.strokeWidth = '1px';

            gTile.appendChild(r);

            if (this.getTextManager().texts[td.uid]) {
              const text = this.getTextManager().texts[td.uid];

              if (!text.visible) {
                return;
              }

              const g = document.createElement('g');
              const t = document.createElement('text');

              textOutput.appendChild(g);
              g.appendChild(t);
              g.setAttribute(
                'transform',
                `translate(${text.x},${text.y})scale(${text.scale.x},1)`
              );

              t.setAttribute('text-anchor', 'middle');
              t.setAttribute('font-family', TEXT_STYLE.fontFamily);
              t.setAttribute(
                'font-size',
                +this.options.fontSize || TEXT_STYLE.fontSize
              );
              t.setAttribute('font-weight', 'bold');
              t.setAttribute('dy', '5px');
              t.setAttribute('fill', fontColor);
              t.setAttribute('stroke', TEXT_STYLE.stroke);
              t.setAttribute('stroke-width', '0.4');
              t.setAttribute('text-shadow', '0px 0px 2px grey');

              t.innerHTML = text.text;
            }
          }
        }
      });

      return [base, base];
    }

    /** Move event for the y-axis */
    movedY(dY) {
      const vst = this.valueScaleTransform;
      const { y, k } = vst;
      const height = this.dimensions[1];
      // clamp at the bottom and top
      if (y + dY / k > -(k - 1) * height && y + dY / k < 0) {
        this.valueScaleTransform = vst.translate(0, dY / k);
      }
      this.rectGraphics.position.y = this.valueScaleTransform.y;
      this.getMouseOverGraphics().position.y = this.valueScaleTransform.y;
      this.vertY = this.valueScaleTransform.y;
      this.animate();

      if (this.vertY - this.prevVertY > this.dimensions[1] / 2) {
        this.render();
      }
    }

    /** Zoomed along the y-axis */
    zoomedY(yPos, kMultiplier) {
      const newTransform = zoomedY(
        yPos,
        kMultiplier,
        this.valueScaleTransform,
        this.dimensions[1]
      );
      this.valueScaleTransform = newTransform;

      let k1 = newTransform.k;
      const t1 = newTransform.y;

      let toStretch = false;
      k1 /= this.prevK;

      if (k1 > 1.5 || k1 < 1 / 1.5) {
        // this is to make sure that annotations aren't getting
        // too stretched vertically
        this.prevK *= k1;

        k1 = 1;

        toStretch = true;
      }

      this.vertK = k1;
      this.vertY = t1;

      if (toStretch) {
        this.render();
      }
      this.rectGraphics.scale.y = k1;
      this.rectGraphics.position.y = t1;

      this.getMouseOverGraphics().scale.y = k1;
      this.getMouseOverGraphics().position.y = t1;

      // this.textGraphics.scale.y = k1;
      // this.textGraphics.position.y = t1;
      this.draw();
      this.animate();
    }


    getMouseOverHtml(trackX, trackY) {
      if (!this.tilesetInfo) {
        return '';
      }

      if (!this.drawnRects) {
        return '';
      }

      this.getMouseOverGraphics().clear();
      this.animate();

      const closestText = '';

      const point = [trackX, trackY];
      const visibleRects = Object.values(this.drawnRects);


      for (let i = 0; i < visibleRects.length; i++) {
        const rect = visibleRects[i][0].slice(0);

        const newArr = polyToPoly(
          rect,
          this.rectGraphics.scale.x,
          this.rectGraphics.position.x,
          this.rectGraphics.scale.y,
          this.rectGraphics.position.y
        );

        const pc = classifyPoint(newArr, point);
        
        if (pc === -1) {
          if (!this.hovered) {
            this.hovered = visibleRects[i][1].value;
          }

          renderBarbell(
            visibleRects[i][1].value,
            this.getMouseOverGraphics(),
            this,
            true,
            visibleRects[i][1].strand
          );

          this.animate();

          const parts = visibleRects[i][1].value.fields;

      if (objUnderMouse) {
        if (objUnderMouse.mouseOver) {
          return objUnderMouse.mouseOver;
        }
        return objUnderMouse.fields.join(' ');
      }

      if (this.hovered) {
        this.hovered = null;
      }

      return closestText;
    }
  }

  return new BarbellTrackClass(...args);
}

const icon =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd" clip-rule="evenodd" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="1.5"><path d="M4 2.1L.5 3.5v12l5-2 5 2 5-2v-12l-5 2-3.17-1.268" fill="none" stroke="currentColor"/><path d="M10.5 3.5v12" fill="none" stroke="currentColor" stroke-opacity=".33" stroke-dasharray="1,2,0,0"/><path d="M5.5 13.5V6" fill="none" stroke="currentColor" stroke-opacity=".33" stroke-width=".9969299999999999" stroke-dasharray="1.71,3.43,0,0"/><path d="M9.03 5l.053.003.054.006.054.008.054.012.052.015.052.017.05.02.05.024 4 2 .048.026.048.03.046.03.044.034.042.037.04.04.037.04.036.042.032.045.03.047.028.048.025.05.022.05.02.053.016.053.014.055.01.055.007.055.005.055v.056l-.002.056-.005.055-.008.055-.01.055-.015.054-.017.054-.02.052-.023.05-.026.05-.028.048-.03.046-.035.044-.035.043-.038.04-4 4-.04.037-.04.036-.044.032-.045.03-.046.03-.048.024-.05.023-.05.02-.052.016-.052.015-.053.012-.054.01-.054.005-.055.003H8.97l-.053-.003-.054-.006-.054-.008-.054-.012-.052-.015-.052-.017-.05-.02-.05-.024-4-2-.048-.026-.048-.03-.046-.03-.044-.034-.042-.037-.04-.04-.037-.04-.036-.042-.032-.045-.03-.047-.028-.048-.025-.05-.022-.05-.02-.053-.016-.053-.014-.055-.01-.055-.007-.055L4 10.05v-.056l.002-.056.005-.055.008-.055.01-.055.015-.054.017-.054.02-.052.023-.05.026-.05.028-.048.03-.046.035-.044.035-.043.038-.04 4-4 .04-.037.04-.036.044-.032.045-.03.046-.03.048-.024.05-.023.05-.02.052-.016.052-.015.053-.012.054-.01.054-.005L8.976 5h.054zM5 10l4 2 4-4-4-2-4 4z" fill="currentColor"/><path d="M7.124 0C7.884 0 8.5.616 8.5 1.376v3.748c0 .76-.616 1.376-1.376 1.376H3.876c-.76 0-1.376-.616-1.376-1.376V1.376C2.5.616 3.116 0 3.876 0h3.248zm.56 5.295L5.965 1H5.05L3.375 5.295h.92l.354-.976h1.716l.375.975h.945zm-1.596-1.7l-.592-1.593-.58 1.594h1.172z" fill="currentColor"/></svg>';

BarbellTrack.config = {
  type: 'barbell',
  datatype: ['bedpe'],
  orientation: '1d-horizontal',
  name: 'Barbell',
  thumbnail: new DOMParser().parseFromString(icon, 'text/xml').documentElement,
  availableOptions: [
    'showTexts'
  ],
  defaultOptions: {},

  optionsInfo: {},
};
