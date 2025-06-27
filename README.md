# Real-Earth Street War

## Project Vision

This project is a prototype for a massively multiplayer online strategy game inspired by the classic board game *Risk*. The game world is a 1:1 representation of the real Earth, where players, organized into gangs or factions, fight to capture and control real-world streets and territories.

The core gameplay loop is intended to be:
- **Territory Control:** Every street segment is a distinct, conquerable territory.
- **Resource Generation:** Owning territories generates resources. The plan is to have resource generation tied to properties like the length of a road.
- **Strategic Depth:** A street's defensibility is determined by how many other streets it connects to, creating natural choke points and strategic fronts.

## Current Status

This repository contains a **frontend-only prototype** built with vanilla HTML, CSS, and JavaScript. It is not yet a playable game but rather a proof-of-concept for the client-side map interface.

**Current features include:**
- An interactive, full-screen map of the world using Mapbox.
- The ability to dynamically fetch and display real-world road data for the current map view from OpenStreetMap.
- A zoom-level check to prevent the application from fetching too much data and crashing.
- Roads are rendered as distinct, selectable vector lines.
- Clicking a road highlights it and displays its properties (Name, Type, OSM ID) in a UI panel.

## Technical Implementation

### Tech Stack
- **HTML5, CSS3, JavaScript (ES6+):** The core technologies for the web client.
- **Mapbox GL JS (`v2.9.1`):** The library used for rendering the high-performance, interactive map.
  - The Mapbox style is currently set to `mapbox://styles/mapbox/streets-v11`.
  - The public access token is hardcoded in `script.js`. This is standard practice for Mapbox public tokens (`pk.*`), which are secured via URL whitelisting in the Mapbox account dashboard, not by hiding the key itself.
- **Overpass API:** A read-only API used to query up-to-date OpenStreetMap (OSM) data. The prototype sends queries to this API to get all "ways" (roads) within the user's current map view.
- **osmtogeojson (`v3.0.0-beta.4`):** A small client-side library used to convert the raw JSON data from the Overpass API into the standard GeoJSON format required by Mapbox GL JS.

### Project Structure
- `index.html`: The main entry point for the application. It sets up the basic page structure and includes all necessary CSS and JavaScript files.
- `style.css`: Contains all custom styles for the UI elements, such as the title, buttons, and information panel.
- `script.js`: The heart of the prototype. This file contains all the client-side logic:
  - Mapbox map initialization.
  - The click listener for the "Load Roads" button.
  - The function to construct the Overpass API query and fetch data.
  - Logic to add the road data to the map as two separate layers: one for unselected roads (`road-lines`) and one for the currently selected road (`selected-road-line`).
  - The click handler for selecting a road, which populates the UI panel with its data.
- `.gitignore`: Standard configuration to exclude files like `node_modules` and `.env` from version control, in preparation for future backend development.

## How to Run the Project

This is a static web project with no build process.

1.  Ensure you have a working internet connection (to fetch map tiles and road data).
2.  Simply open the `index.html` file in any modern web browser.
3.  For best results, run it from a local web server (e.g., using the "Live Server" extension in VS Code), although it will also work via the `file:///` protocol.

## Next Steps (Where We Left Off)

The project is at a point where the frontend proof-of-concept is solid. The next phase can proceed in several directions:

1.  **Continue Frontend Development:**
    - Add a "Claim" button to the info panel. This would be the next logical step in the UI.
    - Visually differentiate roads based on their type (e.g., `primary`, `residential`) using data-driven styling in Mapbox.

2.  **Begin Backend Development:** This is the most significant next step to turn the prototype into a true game. The proposed stack is:
    - **Backend Framework:** Node.js (likely with a framework like Express or Fastify).
    - **Database:** PostgreSQL with the **PostGIS** extension. This is critical for efficiently storing and querying the geospatial data of the roads and territory ownership.

The immediate next step we were considering was to **add a "Claim" button to the UI panel** as a final piece of frontend work before tackling the backend. 