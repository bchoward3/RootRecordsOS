**Brandon Howard**
University of Wisconsin–Madison — GEOG 576 (final project)
bchoward@wisc.edu
# RootRecords - Genealogy Field Mapping Application

## Overview
RootRecords is a full-stack FOSS web mapping application built for genealogy research. It allows users to spatially record grave sites to uncover ancestral and descendant relationships across generations through an interactive family web visualization.

The application was designed with a specific real-world use case in mind: conducting a family mapping project in eastern Kentucky in September 2026. While originally envisioned primarily as a desktop application for research and display it has a powerful secondary function as a mobile data collection device. New features have been added in order to streamline the record collection process and address the often difficult task of field data collection in sub-optimal conditions (rural areas with poor service, inclement weather and dense foliage). 

Most genealogical data exists in tabular form with no spatial component. RootRecords addresses this gap by providing a geographic record of family history that can reveal migration patterns, family clustering, and generational dispersal that tabular data alone fails to convey. 

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

### Site Management and Display Features
- New or existing person: when adding a site, users can either create a new Person record or search existing records and link to one already in the database.
- 'Add Grave' workflow: a three-step panel enabling the user to begin entry of the new grave location with optional media: photograph (upload from desktop or camera access via mobile) and audio recording for a maximum of two minutes. The next panel prompts the user for GPS location permission or allows them to manually place the new point on the map or select from an existing cemetery. The final panel allows the users to fill in biographical data regarding the individuals: name (required), DOB, DOD, father and mother names, cemetery name, county and state. A small 'Notes' section at the bottom allows users the opportunity to document anything else they desire before saving. 
- Save & Add Another: expedited workflow allowing a user to start a new record with the last location carried over; designed for multiple graves in a single cemetery to hasten record entry.
- Pop up baseball card: pop up associated with the grave displaying photograph if provided as well as all non-null fields. The pop contains 
- Edit and Delete: accessible from both the popup (Edit/Delete action buttons) and the built-in Editor widget
- Photo and document attachments:all three site layers support file attachments for photos, scanned documents (e.g. death certificates), and general files

### Filter by Person
- Search for any individual by name to filter all three site layers simultaneously
- Browse all recorded persons alphabetically with birth/death year when available
- Selecting a person from browse automatically applies the filter

### Family Web Visualization
- Show All Family Web: draws lines connecting all graves with known parent–child relationships across the entire dataset, revealing migration patterns at a glance
- Trace Family Web: activated from the Filter by Person panel after selecting an individual; traces bidirectionally up to 4 generations in both directions:
  - **Red lines** (ancestors) — gets progressively lighter with each generation back
  - **Blue lines** (descendants) — gets progressively lighter with each generation forward
- Name labels appear on all graves involved in the active family web
- Map automatically zooms to fit the full extent of the traced lineage
- Generation key legend displayed when trace is active

---

## Backend

The backend is a single ArcGIS Online hosted feature service (`RootRecords/FeatureServer`) containing:

| Layer Index | Name | Type | Purpose |
|---|---|---|---|
| 0 | Birthplace | Point feature class | Records where individuals were born |
| 1 | House | Point feature class | Records homes and other sites of interest |
| 2 | Graves | Point feature class | Records burial sites |
| 3 | Persons | Non-spatial table | Stores biographical data (DOB, DOD, Father, Mother) |

Relationship classes are defined between each site layer and the Persons table via `GlobalID → person_globalid`, allowing a single Person record to be linked to multiple sites across different feature classes.

Attachments are enabled on all three point feature layers to support photo capture via Esri Field Maps.

---

## Family Web

The family web feature matches names between the `Father` and `Mother` text fields in the Persons table and the `person_id` field on the Graves layer. Name matching is case-insensitive. Consistent spelling is required for links to resolve correctly.

*Ancestor trace (upward): follows Father/Mother fields from the selected person backward up to 4 generations, drawing a line between each child's grave and the matching parent's grave.

*Descendant trace (downward): Builds a reverse lookup of who has the selected person listed as their Father or Mother, then follows those links forward up to 4 generations.

---

## Field Maps Integration

RootRecords is designed to work alongside Esri Field Maps for in-the-field data collection:

- The RootRecords web map is available in Field Maps after signing in with ArcGIS Online credentials
- All three feature layers are configured with Field Maps forms: Person Name is the only required field; all other fields are optional and can be backfilled later
- Attachments (photos, documents) can be captured directly from the device camera
- Offline sync is enabled for use in areas with limited cell coverage
- This has not been tested yet due to my visit home being postponed until September

## Known limitations and issues

- Family web name matching requires exact spelling consistency between the `Father`/`Mother` fields in the Persons table and the `person_id` field on Graves. Spelling variations will break the link (I haven't come up with a better way to link this as of yet).
- The application is currently set to public sharing on ArcGIS Online to allow unauthenticated access.
- Several ArcGIS SDK widgets (Expand, Legend, BasemapGallery) are marked deprecated in SDK 5.1 in favor of web components. These continue to function correctly but will need to be addressed if updated in the future.



