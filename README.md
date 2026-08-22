**Brandon Howard**
University of Wisconsin–Madison — GEOG 576 (final project)
bchoward@wisc.edu
# RootRecords - Genealogy Field Mapping Application

## Overview
RootRecords is a full-stack FOSS web mapping application built for genealogy research. It allows users to spatially record grave sites to uncover ancestral and descendant relationships across generations through an interactive family web visualization.

The application was designed with a specific real-world use case in mind: conducting a family mapping project in eastern Kentucky in September 2026. While originally envisioned primarily as a desktop application for research and display it has a powerful secondary function as a mobile data collection device. New features have been added in order to streamline the record collection process and address the often difficult task of field data collection in sub-optimal conditions (rural areas with poor service, inclement weather and dense foliage). 

Most genealogical data exists in tabular form with no spatial component. RootRecords addresses this gap by providing a geographic record of family history that can reveal migration patterns, family clustering, and generational dispersal that tabular data alone fails to convey. 

### Architecture ###

## Stack
| Layer | Technology |
|---|---|
| Map | Leaflet.js 1.9.4 |
| Backend | Supabase — PostgreSQL + PostGIS + Auth + Storage |
| Routing | OpenRouteService (`api.heigit.org`) |
| EXIF | exifr 7.1.3 — pulls GPS from photo metadata unless disabled |
| Offline | Service Worker + IndexedDB + Web App Manifest |
| Hosting | GitHub Pages |

## Files
| File | Purpose |
|---|---|
| `index.html` | Structure |
| `styles.css` | Styling |
| `app.js` | Application behavior and logic |
| `route.js` | ORS routing module → `window.RRRoute` |
| `db.js` | IndexedDB offline queue → `window.RRDb` |
| `sw.js` | Service Worker: app shell + map tile caching |
| `manifest.json` | PWA config for Add to Home Screen on phone |

## Front
HTML, CSS, and JavaScript hosted by GitHub Pages. Leaflet.js renders the map with four libraries load from CDNs: Leaflet, the Supabase client, and exifr for reading GPS from photo metadata. The interface is a sepia and parchment theme in Georgia serif built mobile-first: a fixed header, a four-button toolbar, floating map controls on the right, and slide-up panels. Tap targets are a minimum of 44px throughout. The pop up baseball card is a draggable, resizable floating panel rather than a fixed sheet so it can be moved off a marker while reading. 

## Backend
The backend is a Backend is Supabase: PostgreSQL with PostGIS, Auth, and Storage. Three tables — persons, graves (with a geography Point and GIST index), attachments. PostgreSQL row level security grants read to anon/guests and writes to authenticated users by providing security at the database level. Geometry comes back through a get_graves_geojson() RPC rather than direct selects which would return WKB hex.

| Layer Index | Name | Type | Purpose |
| 2 | Graves | Point feature class | Records burial sites |
| 3 | Persons | Non-spatial table | Stores biographical data (DOB, DOD, Father, Mother) |
| 4 | Attachments | Non-spatial files | Stores additional documents (PDFs, jpegs, audio) |

Relationship classes are defined between each site layer and the Persons table via `GlobalID → person_globalid`, allowing a single Person record to be linked to multiple sites across different feature classes. Attachments are enabled on for photo capture and document upload.

## Offline (Service Worker + IndexedDB + Web App Manifest)
- **Service Worker** (`sw.js`) — caches the app's files and downloaded map tiles so it loads and the map draws without a connection.
- **IndexedDB** (`db.js`) — queues records captured offline, along with associated photos and audio, and syncs when the connection returns. Stored on disk so the queue survives the app being closed or terminated.
- **Web App Manifest** (`manifest.json`) — lets the site install to a phone's home screen and open full-screen like a native app.

## Authentication
- Sign in handled by Supabase with accounts required to create, edit and delete records.
- Guests are provided the option to read current data with no editing permissions but may otherwise filter and query records while making full use of the tools provided (family trace, navigation, etc).

## Map Features & Navigation
- Centered on Kentucky at present for upcoming field data collection.
- Additional widgets include interactive labels, zoom to all records and a locate to determine user GPS if allowed.
- Labels are highly configurable to reduce screen clutter: hover lables are everpresent while the label button allows the user to permanently place labels with adjustable zoom thresholds. 
- Zoom to all records provides the user the ability to reset the map view to the available records.
- Locate prompts the user for GPS permission to re-center the screen on the user's area to begin field recording. 
- Basemap Gallery for switching between CartoDB Voyager (default), USGS Topo, Light Gray, OpenStreetMap, Satellite and OpenTopo.
- Offline map tile is downloadable by area to address issues that might arise with field collection in poor service areas. This can be discarded when no longer needed.
- Grave marker halos to provide contrast against basemaps for greater visbility. 
- OpenRouteService provided by HeiGIT for navigation to records with minimizable turn-by-turn directions panel. The application falls back to a bearing and distance for areas with no OSR data.

---

### Feature Toolbar ###

### Add Grave (dual workflow)
- New or existing person: when adding a site, users can either create a new Person record or search existing records and link to one already in the database.
- 'Add Grave' workflow: a three-step panel enabling the user to begin entry of the new grave location with optional media: photograph (upload from desktop or camera access via mobile) and audio recording for a maximum of two minutes. The next panel prompts the user for GPS location permission or allows them to manually place the new point on the map or select from an existing cemetery (EXIF data can be utilized if the user has it enabled). The final panel allows the users to fill in biographical data regarding the individuals: name (required), DOB, DOD, father and mother names, cemetery name, county and state. A small 'Notes' section at the bottom allows users the opportunity to document anything else they desire before saving. 
- Save & Add Another: expedited workflow allowing a user to start a new record with the last location carried over; designed for multiple graves in a single cemetery to hasten record entry.
- Pop up baseball card: pop up associated with the grave displaying photograph if provided as well as all non-null fields. The pop up contains, for priveleged users, editing and deleting capabilites as well as the ability to relocate the grave. There is also an 'Attachments' button to add relevenat files such as pdfs. Photos can be uploaded to create a photo gallery navigable by two arrows.


### Filter by Person
- Search for any individual by name.
- Browse all recorded persons alphabetically with birth/death year when available
- Selecting a person from browse automatically applies the filter and zooms to the selected record while deploying the pop up.

### Family Web Visualization
- Family Web button: draws lines connecting all graves with known parent–child relationships across the entire dataset, revealing migration patterns at a glance. Once selected it can be canceled by clicking the same button ('Hide Web').
- Trace Family Web: activated from the Filter by Person panel after selecting an individual; traces bidirectionally up to 4 generations defined by the user in both directions:
  - **Red lines** (ancestors) — gets progressively lighter with each generation back.
  - **Blue lines** (descendants) — gets progressively lighter with each generation forward.
- Name labels appear on all graves involved in the active family web with halos to indicated involved records.
- Map automatically zooms to fit the full extent of the traced lineage.
- Generation key legend displayed when trace is active.

### Routing & Naviation
- OSR routing using OSM data; uses POST rather than GET, because the parameter it needs isn't available on the GET form. That returns a GeoJSON  line to draw along with turn-by-turn steps.
- ORS will not route to coordinates but snaps to endpoints along nearest road with a 350 meter limitation; anything great results in an eror. The reconciles this by reqeusting nearest road wihin 20 km; the app measures the leftover gap between where the route ends and where the grave actually is. Over 50 metres, it draws that remainder as a dotted amber line with a compass bearing and distance.
- Routing is unavailable offline so it draws a compass bearing from location to grave as a fallback. 
- Accessible from pop up baseball card - allows user to select a grave for turn-by-navigation.
- User selects the appropriate record and clicks the navigation button. A prompt appears informing the user that their location is being retrieved followed by route generation; once calculated the map zooms to the extent of the route.
- Turn by turn directions are displayed in a pop up window. This window can be minimized to view the route in its entirety.
- To cancel the route, select the 'x' button on the upper right corner of the directions windows.  

---

### Known limitations and planned features ###

**Limitations**
- Family web links resolve by matching the `father`/`mother` text fields against other persons' `name` values. Names are trimmed and lowercased before compariso, but spelling variations still break the link so the user bears the brunt of error prevention by ensuring correct records entry. A person must also have a grave record to appear — a parent named but not yet documented ends that branch.
- Cemetery names are free text. Some sites carry two names from Find A Grave (i.e. "Whitt Cemetery #4/Howard Cemetery") and others are numbered variants of the same surname so grouping by name alone is unreliable. This is a limitation in life reflected in the application that I have been unable to find a satisfacotry solution for as of yet.
- Records entered from documentary sources hold approximate coordinates and several share a single cemetery centroid. Nothing in the data marks which positions have been field-verified - this may be added in the future. Graves at identical coordinates render as one marker, and only the top one is tappable.
- Only the first photo on a record shows in the edit panel's attachment list; filenames alone make photos hard to tell apart there though all photos are viewable in the gallery.
- API keys are visible in the deployed JS. GitHub Pages is public regardless of repository visibility so this cannot be resolved by making the repo private.
- OpenStreetMap road coverage is incomplete for rural roads and private cemetery access so routing reaches the vicinity rather than the site with remaining directions bearing/as-the-crow-flies.

**Planned**
- Additional point fields (birthplace, home/house, business) in order to tell a full individual life story.
- Individaul trace: spatiotemporal trace similar to family web allowing user to begin at birthplace and follow an individual along their life journey.
- Address and place search (geocoder) so a cemetery with a known address can be found without scanning the map.
- "How am I related?" relationship calculator over the existing parent graph that reports the connection between the user and any person in the records, with a small tree.
- A `cemeteries` table normalizing names and aliases with cemetery-level attachments for access directions (much like symbolizing by cemetery name in ArcGIS).
- A precision or verified flag distinguishing desk estimates from field-confirmed positions.
- Multi-stop route optimization: click and drag around a group of graves to calculate the best route from your location (traveling salesman problem).
- Handling for graves stacked on identical coordinates - have considered clustering and aggregating but was unable to find the best path forward prior to submission.
- "Life Journey" animated tour from birthplace to grave. Needs additional point fields (birthplace, house, work, etc) before implementing. 



