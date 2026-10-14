// tradedemo-building.js — the three kitchens of the example building, as Imogen laid them
// out in 3D (planner, 2026-10-14; trade share MwLvId7poSyO6G2OU4HmpAnP1t). One stored design per
// kitchen type, keyed by bedrooms, in the planner's own save format (schema 'plinth-planner').
// buildDemoUnits() deep-copies these onto the demo units so every type opens straight into its
// real room and draws its real elevations on the unit card. Data only; no DOM.

export const DEMO_DESIGNS = {
  "1 Bed": {
    "mode": "home",
    "room": {
      "wall": "white",
      "depth": 120,
      "floor": "oak",
      "width": 168,
      "height": 110.4,
      "boxings": [],
      "cornice": "plain",
      "worktop": "marble",
      "openings": [],
      "nextBoxing": 1,
      "nextOpening": 1
    },
    "items": [
      {
        "x": -74,
        "z": -47.75,
        "id": 1,
        "code": "F17",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -48.877,
        "z": -46.75,
        "id": 2,
        "code": "AP1",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -4,
        "z": -47.75,
        "id": 3,
        "code": "F21",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 18,
        "z": -47.75,
        "id": 4,
        "code": "F2",
        "hinge": "R",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 42,
        "z": -47.75,
        "id": 5,
        "code": "F7",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 18,
        "z": -47.75,
        "id": 7,
        "code": "AP6",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 69,
        "z": -46.569,
        "id": 10,
        "code": "T4",
        "open": true,
        "hinge": "R",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -23.877,
        "z": -48,
        "id": 11,
        "code": "F17",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 69,
        "z": -46.569,
        "id": 13,
        "code": "S11",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 35.5,
        "z": -52.75,
        "id": 15,
        "code": "W18",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -0.5,
        "z": -52.75,
        "id": 16,
        "code": "W18",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -48.877,
        "z": -49.75,
        "id": 17,
        "code": "AP26",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -25.5,
        "z": -52.75,
        "id": 18,
        "code": "W22:w14",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -72.254,
        "z": -52.75,
        "id": 23,
        "code": "W22:w14",
        "finish": null,
        "rotDeg": 0,
        "fixedWidth": true
      }
    ],
    "finish": "Butter",
    "handle": "knob",
    "nextId": 24,
    "schema": "plinth-planner",
    "version": 1,
    "customer": {
      "zip": "",
      "name": "",
      "email": "",
      "notes": ""
    },
    "accessories": {}
  },
  "2 Bed": {
    "mode": "home",
    "room": {
      "wall": "chalk",
      "depth": 120,
      "floor": "oak",
      "width": 192,
      "height": 110,
      "boxings": [],
      "cornice": "plain",
      "worktop": "marble",
      "openings": [],
      "nextBoxing": 1,
      "nextOpening": 1
    },
    "items": [
      {
        "x": -52,
        "z": -47.75,
        "id": 2,
        "code": "F7",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -28,
        "z": -47.75,
        "id": 3,
        "code": "F2",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -6,
        "z": -48,
        "id": 4,
        "code": "F21",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 18,
        "z": -47.75,
        "id": 5,
        "code": "F19",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 50,
        "z": -46.75,
        "id": 6,
        "code": "AP2",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -28,
        "z": -47.75,
        "id": 9,
        "code": "AP6",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 82,
        "z": -48,
        "id": 15,
        "code": "F19",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -79,
        "z": -46.569,
        "id": 16,
        "code": "T4",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 50,
        "z": -49.75,
        "id": 17,
        "code": "AP27",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -79,
        "z": -46.569,
        "id": 18,
        "code": "S11",
        "finish": null,
        "hostId": 16,
        "rotDeg": 0
      },
      {
        "x": -46,
        "z": -52.75,
        "id": 21,
        "code": "W18",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -10,
        "z": -52.75,
        "id": 22,
        "code": "W18",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 19.508,
        "z": -52.75,
        "id": 23,
        "code": "W22:w23",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 80.492,
        "z": -52.75,
        "id": 24,
        "code": "W22:w23",
        "finish": null,
        "rotDeg": 0,
        "fixedWidth": true
      }
    ],
    "finish": "Dough",
    "handle": "knob",
    "nextId": 25,
    "schema": "plinth-planner",
    "version": 1,
    "customer": {
      "zip": "",
      "name": "",
      "email": "",
      "notes": ""
    },
    "accessories": {}
  },
  "3 Bed": {
    "mode": "home",
    "room": {
      "wall": "white",
      "depth": 120,
      "floor": "oak",
      "width": 216,
      "height": 110,
      "boxings": [],
      "cornice": "plain",
      "worktop": "marble",
      "openings": [],
      "nextBoxing": 1,
      "nextOpening": 1
    },
    "items": [
      {
        "x": 16.25,
        "z": -47.75,
        "id": 5,
        "code": "F19",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 54.25,
        "z": -46.75,
        "id": 6,
        "code": "AP3",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -94.569,
        "z": 29.25,
        "id": 15,
        "code": "T4",
        "finish": null,
        "rotDeg": 90
      },
      {
        "x": -39.75,
        "z": -47.75,
        "id": 16,
        "code": "F10",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -39.75,
        "z": -47.75,
        "id": 17,
        "code": "AP19",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -9.75,
        "z": -47.75,
        "id": 18,
        "code": "F7",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -94.569,
        "z": -0.75,
        "id": 19,
        "code": "T4",
        "hinge": "R",
        "finish": null,
        "rotDeg": 90
      },
      {
        "x": -95.75,
        "z": -25.75,
        "id": 20,
        "code": "F15R",
        "finish": null,
        "rotDeg": 90
      },
      {
        "x": 92.25,
        "z": -47.75,
        "id": 21,
        "code": "F19",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -70.75,
        "z": -47.75,
        "id": 22,
        "code": "F22",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 54.25,
        "z": -49.75,
        "id": 23,
        "code": "AP28",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -94.569,
        "z": -0.75,
        "id": 25,
        "code": "S11",
        "finish": null,
        "hostId": 19,
        "rotDeg": 90
      },
      {
        "x": -94.569,
        "z": 29.25,
        "id": 26,
        "code": "S11",
        "finish": null,
        "hostId": 15,
        "rotDeg": 90
      },
      {
        "x": -100.75,
        "z": -30.75,
        "id": 29,
        "code": "W23:w30",
        "finish": null,
        "rotDeg": 90
      },
      {
        "x": 91.242,
        "z": -52.75,
        "id": 37,
        "code": "W15",
        "hinge": "R",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": 17.258,
        "z": -52.75,
        "id": 38,
        "code": "W15",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -15.742,
        "z": -52.75,
        "id": 39,
        "code": "W19",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -57.742,
        "z": -52.75,
        "id": 40,
        "code": "W19",
        "finish": null,
        "rotDeg": 0
      },
      {
        "x": -93.371,
        "z": -52.75,
        "id": 41,
        "code": "W22:w29.5",
        "finish": null,
        "rotDeg": 0
      }
    ],
    "finish": "Butter",
    "handle": "knob",
    "nextId": 42,
    "schema": "plinth-planner",
    "version": 1,
    "customer": {
      "zip": "",
      "name": "",
      "email": "",
      "notes": ""
    },
    "accessories": {}
  }
};
