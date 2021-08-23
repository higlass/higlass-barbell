# Barbell Track for HiGlass

> Display BEDPE data as barbells (two filled regions joined by a line)

[![HiGlass](https://img.shields.io/badge/higlass-😍-red.svg?colorB=7fb4ff&style=flat-square)](http://higlass.io)
[![npm version](https://img.shields.io/npm/v/higlass-arcs.svg?color=7f94ff&style=flat-square)](https://www.npmjs.com/package/higlass-barbell)
[![gzipped size](https://img.badgesize.io/https:/unpkg.com/higlass-arcs/dist/higlass-arcs.min.js?color=e17fff&compression=gzip&style=flat-square)](https://bundlephobia.com/result?p=higlass-arcs)
[![code style prettier](https://img.shields.io/badge/code_style-prettier-f57bf5.svg?style=flat-square)](https://github.com/prettier/prettier)

![Screenshot of the barbell track](https://user-images.githubusercontent.com/2143629/129492480-9a879bd6-deae-4cd6-9c36-10288c2bcbaf.png 'An example of the barbell track')

**Note**: This is the source code for the barbell track only! You might want to check out the following repositories as well:

- HiGlass viewer: https://github.com/higlass/higlass
- HiGlass server: https://github.com/higlass/higlass-server
- HiGlass docker: https://github.com/higlass/higlass-docker

## Installation

```
npm install higlass-barbell
```

## Usage

The live script can be found at:

- https://unpkg.com/higlass-barbell/dist/higlass-barbell.min.js

1. Make sure you load this track prior to `hglib.min.js`. For example:

```html
<script src="higlass-barbell.min.js"></script>
<script src="hglib.min.js"></script>
<script>
  ...
</script>
```

If you build a custom React application, import `higlass-barbell` in your `index.js` as follows:

```javascript
import 'higlass-barbell'; // This import is all you have to do

import React from 'react';
import ReactDOM from 'react-dom';

import App from './App';

ReactDOM.render(<App />, document.getElementById('root'));
```

2. Now, configure the track in your view config and be happy! Cheers 🎉

```javascript
{
  ...
  {
    server: 'http://localhost:8001/api/v1',
    tilesetUid: 'my-aggregated-bedfile.bedpe',
    uid: 'some-uid',
    type: 'barbell',
    options: {
      ...
    },
  },
  ...
}
```

Take a look at [`src/index.html`](src/index.html) for an example.


### Expected data

This track expects bedpe style data served from either a higlass server or [local tile values](https://docs.higlass.io/view_config.html#raw-tile-values). If local tiles are provided, you can set the following extra properties in each data object:

- mouseOver - Text that should appear when the mouse hovers or a barbell
- strokeWidth - The width of the outline of each barbell
- strokeColor - The color of the outline of each barbell
- strokeOpacity - The opacity of the outline of each barbell
- color - The fill color of each barbell

```json
    {
      "uid": 1,
      "fill": "red",
      "strokeWidth": 3,
      "strokeColor": "black",
      "strokeOpacity": 1,
      "xStart": 412232865,
      "xEnd": 412239391,
      "yStart": 412337941,
      "yEnd": 412351977,
      "xChrOffset": 377585195,
      "yChrOffset": 377585195,
      "importance": 0.8289870449281151,
      "mouseOver": "<b>there</b>",
      "fields": [
        "chr3",
        34637670,
        34644196,
        "chr3",
        34742746,
        34756782
      ]
    }
```

## Development

### Installation

```bash
$ git clone https://github.com/higlass/higlass-barbell && higlass-barbell
$ npm install
```

### Commands

**Developmental server**: `npm start`
**Production build**: `npm run build`
**Deploy demo**: `npm run deploy`
