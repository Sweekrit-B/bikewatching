import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS loaded:', mapboxgl);

// Correct property name is `accessToken` (camelCase)
mapboxgl.accessToken = 'pk.eyJ1Ijoic3dlZWtyaXRiIiwiYSI6ImNtcDZnc3ZudjBpNm8ycm9teGQ4ejN2am8ifQ.wyjh_b-uN4Q7oDVnh4A3lA';

const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

let departuresByMinute = Array.from({ length: 1440 }, () => []); // Initialize array for 24 hours * 60 minutes
let arrivalsByMinute = Array.from({ length: 1440 }, () => []); // Same for arrivals

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point); // Project to pixel coordinates
  return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

function computeStationTraffic(stations, timeFilter = -1) {
    const departures = d3.rollup(
        filterByMinute(departuresByMinute, timeFilter),
        (v) => v.length,
        (d) => d.start_station_id,
    );
    const arrivals = d3.rollup(
        filterByMinute(arrivalsByMinute, timeFilter),
        (v) => v.length,
        (d) => d.end_station_id,
    );
    return stations.map((station) => {
        let id = station.short_name;
        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
  for (const trip of trips) {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    departuresByMinute[startedMinutes].push(trip);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);
    arrivalsByMinute[endedMinutes].push(trip);
  }

  return timeFilter === -1
    ? trips
    : trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // No filtering, return all trips
  }

  // Normalize both min and max minutes to the valid range [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  // Handle time filtering across midnight
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

map.on('load', async () => {
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });
    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: {
            'line-color': 'green',
            'line-width': 2,
            'line-opacity': 0.4,
        },
    });
    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });
    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: {
            'line-color': 'green',
            'line-width': 2,
            'line-opacity': 0.4,
        },
    });

    let jsonData;
    try {
        const jsonUrl = 'bluebikes-stations.json';
        jsonData = await d3.json(jsonUrl);
        console.log('JSON data loaded:', jsonData);
    } catch (error) {
        console.error('Error loading JSON data:', error);
    }

    let stations = jsonData.data.stations;
    console.log('Stations data:', stations);
    
    const svg = d3.select('#map').select('svg');
    const circles = svg
        .selectAll('circle')
        .data(stations, (d) => d.short_name)
        .enter()
        .append('circle')
        .attr('r', 5)
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('opacity', 0.8)
        .style('pointer-events', 'auto') // enable events on circles specifically
        .style('--departure-ratio', (d) => d.departures / (d.totalTraffic || 1)) // Avoid division by zero
    
    function updatePositions() {
        circles
            .attr('cx', d => getCoords(d).cx)
            .attr('cy', d => getCoords(d).cy);
    }

    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    let trips;
    try {
        const csvUrl = 'bluebikes-traffic-2024-03.csv';
        trips = await d3.csv(csvUrl, (trip) => {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
            return trip;
        });
        console.log('Trips data loaded:', trips);
    } catch (error) {
        console.error('Error loading CSV data:', error);
    }

    filterTripsbyTime(trips, -1); // Preprocess trips to populate departuresByMinute and arrivalsByMinute
    stations = computeStationTraffic(stations);

    const radiusScale = d3.scaleSqrt()
        .domain([0, d3.max(stations, d => d.totalTraffic)])
        .range([0, 25]);
    
    circles.attr('r', d => radiusScale(d.totalTraffic))
    circles
        .each(function(d) {
            d3.select(this)
                .append('title')
                .text(`${d.name}\nArrivals: ${d.arrivals}\nDepartures: ${d.departures}\nTotal Traffic: ${d.totalTraffic}`);
        });
    
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    function updateScatterPlot(timeFilter) {
        // Get only the trips that match the selected time filter
        timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

        // Recompute station traffic based on the filtered trips
        const filteredStations = computeStationTraffic(stations, timeFilter);

        // Update the scatterplot by adjusting the radius of circles
        circles
            .data(filteredStations, (d) => d.short_name)
            .join('circle') // Ensure the data is bound correctly
            .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
            .style('--departure-ratio', (d) => d.departures / (d.totalTraffic || 1)); // Update departure ratio for styling
    }

    function updateTimeDisplay() {
        let timeFilter = Number(timeSlider.value); // Get slider value

        if (timeFilter === -1) {
            selectedTime.textContent = ''; // Clear time display
            anyTimeLabel.style.display = 'block'; // Show "(any time)"
        } else {
            selectedTime.textContent = formatTime(timeFilter); // Display formatted time
            anyTimeLabel.style.display = 'none'; // Hide "(any time)"
        }

        // Call updateScatterPlot to reflect the changes on the map
        updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay(); // Initialize display on page load
    updateScatterPlot(Number(timeSlider.value)); // Initial plot based on default slider value

    let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
});