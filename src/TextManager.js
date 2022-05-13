import boxIntersect from 'box-intersect';

export const MAX_TEXTS = 50;
const FONT_SIZE = 14;
// the label text should have a white outline so that it's more
// visible against a similar colored background
export const TEXT_STYLE = {
  align: 'center',
  fontSize: `${FONT_SIZE}px`,
  fontFamily: 'Arial',
  stroke: 'white',
  strokeThickness: 2,
  fontWeight: 400,
  dropShadow: true,
  dropShadowColor: 'white',
  dropShadowDistance: 0,
  dropShadowBlur: 2,
};

export class TextManager {
  constructor(track, HGC) {
    this.track = track;
    this.texts = {};
    this.PIXI = HGC.libraries.PIXI;
    this.HGC = HGC

    // store a list of already created texts so that we don't
    // have to recreate new ones each time
    this.textsList = [];

    this.textWidths = {};
    this.textHeights = {};

    this.textGraphics = new this.PIXI.Graphics();
    this.track.pMain.addChild(this.textGraphics);
  }

  hideOverlaps() {
    const [allBoxes, allTexts] = [this.allBoxes, this.allTexts];
    // Calculate overlaps from the bounding boxes of the texts

    boxIntersect(allBoxes, (i, j) => {
      if (allTexts[i].importance > allTexts[j].importance) {
        if (allTexts[i].text.visible) {
          allTexts[j].text.visible = false;
        }
      } else if (allTexts[j].text.visible) {
        allTexts[i].text.visible = false;
      }
    });
  }

  startDraw() {
    this.allBoxes = [];
    this.allTexts = [];
  }

  lightUpdateSingleText(td, xMiddle, yMiddle, textInfo) {
    if (!this.texts[td.uid]) return;
    if (!this.track.options.showTexts) return;

    const text = this.texts[td.uid];

    const TEXT_MARGIN = 3;

    text.position.x = xMiddle;
    text.position.y = yMiddle;

    text.visible = true;
    this.allBoxes.push([
      text.position.x - TEXT_MARGIN,
      text.position.y - this.textHeights[td.uid] / 2,
      text.position.x + this.textWidths[td.uid] + TEXT_MARGIN,
      text.position.y + this.textHeights[td.uid] / 2,
    ]);

    this.allTexts.push({
      text,
      ...textInfo,
    });
  }

  updateSingleText(td, xMiddle, yMiddle, textText) {
    if (!this.texts[td.uid]) return;

    const text = this.texts[td.uid];

    text.position.x = xMiddle;
    text.position.y = yMiddle;
    text.nominalY = yMiddle;

    const fontColor =
      this.track.options.fontColor !== undefined
        ? this.HGC.utils.colorToHex(this.track.options.fontColor)
        : 'black';

    text.style = {
      ...TEXT_STYLE,
      fill: fontColor,
      fontSize: +this.track.options.fontSize || TEXT_STYLE.fontSize,
    };
    text.text = textText;

    if (!(td.uid in this.textWidths)) {
      text.updateTransform();
      const textWidth = text.getBounds().width;
      const textHeight = text.getBounds().height;

      // the text size adjustment compensates for the extra
      // size that the show gives it
      const TEXT_SIZE_ADJUSTMENT = 5;

      this.textWidths[td.uid] = textWidth;
      this.textHeights[td.uid] = textHeight - TEXT_SIZE_ADJUSTMENT;
    }
  }

  updateTexts() {
    this.texts = {};

    if (!this.track.options.showTexts) {
      this.textGraphics.removeChildren();
      this.textsList = [];
      return;
    }

      let yRange = [
        (0 - this.track.vertY) / (this.track.vertK * this.track.prevK),
        (this.track.dimensions[1] - this.track.vertY) /
          (this.track.vertK * this.track.prevK),
      ];

      const yRangeWidth = yRange[1] - yRange[0];
      yRange = [yRange[0] - yRangeWidth * 0.8, yRange[1] + yRangeWidth * 0.8];

      const relevantSegments = this.track.uniqueSegments.filter(
        x => !x.yMiddle || (x.yMiddle > yRange[0] && x.yMiddle < yRange[1]),
      );

      relevantSegments.forEach((td, i) => {
        // don't draw too many texts so they don't bog down the frame rate
        if (i >= (+this.track.options.maxTexts || MAX_TEXTS)) {
          return;
        }

        let text = this.textsList[i];

        if (!text) {
          text = new this.PIXI.Text();
          this.textsList.push(text);
          this.textGraphics.addChild(text);
        }

        text.style = {
          ...TEXT_STYLE,
          fontSize: +this.track.options.fontSize || TEXT_STYLE.fontSize,
        };

        // geneInfo[3] is the gene symbol

        if (this.flipText) {
          text.scale.x = -1;
        }

        text.anchor.x = 0.5;
        text.anchor.y = 0.5;

        this.texts[td.uid] = text;
      });

      while (
        this.textsList.length >
        Math.min(
          relevantSegments.length,
          +this.track.options.maxTexts || MAX_TEXTS,
        )
      ) {
        const text = this.textsList.pop();
        this.textGraphics.removeChild(text);
      }
    
  }
}