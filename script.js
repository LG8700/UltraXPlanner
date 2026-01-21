const gpxFileInput = document.getElementById("gpxFile");
const gpxStatus = document.getElementById("gpxStatus");
const totalDistanceEl = document.getElementById("totalDistance");
const totalGainLossEl = document.getElementById("totalGainLoss");
const manualElevation = document.getElementById("manualElevation");
const manualGainInput = document.getElementById("manualGain");
const manualLossInput = document.getElementById("manualLoss");

const startTimeInput = document.getElementById("startTime");
const targetHoursInput = document.getElementById("targetHours");
const targetMinutesInput = document.getElementById("targetMinutes");

const addStationButton = document.getElementById("addStation");
const stationsTable = document.getElementById("stationsTable");
const legsOutput = document.getElementById("legsOutput");

const state = {
  points: [],
  totalDistance: 0,
  totalGain: 0,
  totalLoss: 0,
  hasElevation: false,
};

const formatTime = (minutesFromStart, startTime) => {
  if (minutesFromStart == null || Number.isNaN(minutesFromStart)) {
    return "--:--";
  }
  const [startH, startM] = startTime.split(":").map(Number);
  if (Number.isNaN(startH) || Number.isNaN(startM)) {
    return "--:--";
  }
  const totalMinutes = startH * 60 + startM + minutesFromStart;
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = Math.floor(normalized % 60);
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}`;
};

const formatMinutes = (minutes) => {
  if (!Number.isFinite(minutes)) {
    return "--";
  }
  const mins = Math.round(minutes);
  return `${mins} min`;
};

const kmToString = (value) => `${value.toFixed(1)} km`;

const metersToString = (value) => `${Math.round(value)} m`;

const getStations = () => {
  const rows = [...stationsTable.querySelectorAll(".table-row")];
  return rows.map((row) => {
    const name = row.querySelector(".station-name").value.trim();
    const distance = parseFloat(row.querySelector(".station-distance").value);
    const rest = parseFloat(row.querySelector(".station-rest").value);
    const actual = row.querySelector(".station-actual").value;
    return {
      row,
      name: name || "Aid station",
      distance: Number.isFinite(distance) ? distance : null,
      rest: Number.isFinite(rest) ? rest : 0,
      actual,
    };
  });
};

const parseTimeToMinutes = (timeValue) => {
  if (!timeValue) {
    return null;
  }
  const [hours, minutes] = timeValue.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
};

const haversine = (lat1, lon1, lat2, lon2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
};

const computeStats = () => {
  if (!state.points.length) {
    state.totalDistance = 0;
    state.totalGain = 0;
    state.totalLoss = 0;
    return;
  }
  let distance = 0;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < state.points.length; i += 1) {
    const prev = state.points[i - 1];
    const current = state.points[i];
    distance += current.segment;
    if (state.hasElevation) {
      const delta = current.ele - prev.ele;
      if (delta > 0) {
        gain += delta;
      } else if (delta < 0) {
        loss += Math.abs(delta);
      }
    }
  }
  state.totalDistance = distance;
  state.totalGain = gain;
  state.totalLoss = loss;
};

const buildCumulativeDistance = () => {
  let cumulative = 0;
  return state.points.map((point, index) => {
    if (index > 0) {
      cumulative += point.segment;
    }
    return {
      ...point,
      cumulative,
    };
  });
};

const elevationBetween = (startKm, endKm) => {
  if (!state.hasElevation || state.points.length < 2) {
    return { gain: 0, loss: 0 };
  }
  const points = buildCumulativeDistance();
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    if (current.cumulative < startKm) {
      continue;
    }
    if (prev.cumulative > endKm) {
      break;
    }
    const segmentStart = Math.max(prev.cumulative, startKm);
    const segmentEnd = Math.min(current.cumulative, endKm);
    if (segmentEnd <= segmentStart) {
      continue;
    }
    const ratio = (segmentEnd - segmentStart) / (current.cumulative - prev.cumulative);
    const delta = (current.ele - prev.ele) * ratio;
    if (delta > 0) {
      gain += delta;
    } else if (delta < 0) {
      loss += Math.abs(delta);
    }
  }
  return { gain, loss };
};

const computeLegs = (stations) => {
  const sortedStations = stations
    .filter((station) => station.distance != null)
    .sort((a, b) => a.distance - b.distance);
  const legs = [];
  let start = 0;
  sortedStations.forEach((station) => {
    const end = station.distance;
    if (end > start) {
      legs.push({
        label: `${kmToString(start)} → ${station.name}`,
        start,
        end,
        distance: end - start,
        station,
      });
      start = end;
    }
  });
  if (state.totalDistance > start) {
    legs.push({
      label: `${kmToString(start)} → Finish`,
      start,
      end: state.totalDistance,
      distance: state.totalDistance - start,
      station: null,
    });
  }
  return { legs, sortedStations };
};

const computeEffortDistance = (distance, gain, loss) => {
  const gainPenalty = gain / 100;
  const lossPenalty = loss / 200;
  return distance + gainPenalty + lossPenalty;
};

const computeTargets = () => {
  const stations = getStations();
  const { legs, sortedStations } = computeLegs(stations);
  if (!legs.length || !state.totalDistance) {
    legsOutput.textContent = "Add aid stations and GPX data to see leg targets.";
    stations.forEach((station) => {
      station.row.querySelector(".station-eta").textContent = "--:--";
    });
    return;
  }

  const totalDuration =
    parseFloat(targetHoursInput.value || 0) * 60 +
    parseFloat(targetMinutesInput.value || 0);

  const totalRest = sortedStations.reduce(
    (sum, station) => sum + (station.rest || 0),
    0
  );
  const movingTime = Math.max(totalDuration - totalRest, 0);

  let totalGain = state.totalGain;
  let totalLoss = state.totalLoss;
  if (!state.hasElevation) {
    totalGain = parseFloat(manualGainInput.value || 0);
    totalLoss = parseFloat(manualLossInput.value || 0);
  }

  const legElevations = legs.map((leg) => {
    if (state.hasElevation) {
      return elevationBetween(leg.start, leg.end);
    }
    const distanceRatio = leg.distance / state.totalDistance;
    return {
      gain: totalGain * distanceRatio,
      loss: totalLoss * distanceRatio,
    };
  });

  const efforts = legs.map((leg, index) =>
    computeEffortDistance(leg.distance, legElevations[index].gain, legElevations[index].loss)
  );
  const totalEffort = efforts.reduce((sum, effort) => sum + effort, 0) || 1;

  const startMinutes = parseTimeToMinutes(startTimeInput.value) ?? 0;
  const actualTimes = sortedStations.map((station) => ({
    station,
    actualMinutes: parseTimeToMinutes(station.actual),
  }));

  const latestActualIndex = actualTimes.reduce((latest, current, index) => {
    if (current.actualMinutes == null) {
      return latest;
    }
    return index;
  }, null);

  let remainingMovingTime = movingTime;
  let elapsedMinutes = 0;
  if (latestActualIndex != null) {
    const actualArrival = actualTimes[latestActualIndex].actualMinutes;
    elapsedMinutes = Math.max(actualArrival - startMinutes, 0);
    const remainingRest = sortedStations
      .slice(latestActualIndex)
      .reduce((sum, station) => sum + (station.rest || 0), 0);
    remainingMovingTime = Math.max(totalDuration - elapsedMinutes - remainingRest, 0);
  }

  const legTimes = efforts.map((effort, index) => {
    if (latestActualIndex != null && index <= latestActualIndex) {
      return null;
    }
    const portion = effort / totalEffort;
    return remainingMovingTime * portion;
  });

  let cumulative = 0;
  legsOutput.innerHTML = "";
  legs.forEach((leg, index) => {
    let legTime = legTimes[index];
    if (legTime == null) {
      legTime = 0;
    }
    cumulative += legTime;
    const pace = leg.distance ? legTime / leg.distance : 0;
    const elevation = legElevations[index];
    const card = document.createElement("div");
    card.className = "leg-card";
    card.innerHTML = `
      <div>
        <span>Leg</span>
        <strong>${leg.label}</strong>
      </div>
      <div>
        <span>Distance</span>
        <strong>${kmToString(leg.distance)}</strong>
      </div>
      <div>
        <span>Gain / Loss</span>
        <strong>${metersToString(elevation.gain)} / ${metersToString(
      elevation.loss
    )}</strong>
      </div>
      <div>
        <span>Target pace</span>
        <strong>${formatMinutes(pace)}</strong>
      </div>
      <div>
        <span>Leg time</span>
        <strong>${formatMinutes(legTime)}</strong>
      </div>
    `;
    legsOutput.appendChild(card);
  });

  let etaMinutes = 0;
  sortedStations.forEach((station, index) => {
    const legIndex = legs.findIndex((leg) => leg.station === station);
    if (legIndex === -1) {
      return;
    }
    const legTime = legTimes[legIndex] ?? 0;
    etaMinutes += legTime;
    const eta = formatTime(etaMinutes, startTimeInput.value);
    station.row.querySelector(".station-eta").textContent = eta;
    etaMinutes += station.rest || 0;
  });
};

const updateStatsDisplay = () => {
  totalDistanceEl.textContent = kmToString(state.totalDistance || 0);
  totalGainLossEl.textContent = `${metersToString(state.totalGain)} / ${metersToString(
    state.totalLoss
  )}`;
};

const parseGpx = (text) => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "text/xml");
  const points = [...xml.querySelectorAll("trkpt")];
  const parsed = points.map((point, index) => {
    const lat = parseFloat(point.getAttribute("lat"));
    const lon = parseFloat(point.getAttribute("lon"));
    const eleNode = point.querySelector("ele");
    const ele = eleNode ? parseFloat(eleNode.textContent) : null;
    let segment = 0;
    if (index > 0) {
      const prev = points[index - 1];
      segment = haversine(
        parseFloat(prev.getAttribute("lat")),
        parseFloat(prev.getAttribute("lon")),
        lat,
        lon
      );
    }
    return {
      lat,
      lon,
      ele,
      segment,
    };
  });

  state.hasElevation = parsed.some((point) => Number.isFinite(point.ele));
  state.points = parsed.map((point) => ({
    ...point,
    ele: Number.isFinite(point.ele) ? point.ele : 0,
  }));
  computeStats();
  updateStatsDisplay();
  manualElevation.classList.toggle("active", !state.hasElevation);
};

const handleGpxUpload = async (event) => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  gpxStatus.textContent = `Loaded ${file.name}.`;
  const text = await file.text();
  parseGpx(text);
  computeTargets();
};

const addStationRow = () => {
  const row = document.createElement("div");
  row.className = "table-row";
  row.dataset.row = "true";
  row.innerHTML = `
    <input type="text" placeholder="Aid station name" class="station-name" />
    <input type="number" placeholder="Distance (km)" class="station-distance" min="0" step="0.1" />
    <input type="number" placeholder="Rest (min)" class="station-rest" min="0" step="1" />
    <div class="station-eta">--:--</div>
    <input type="time" class="station-actual" />
    <button class="action ghost remove">Remove</button>
  `;
  stationsTable.appendChild(row);
};

stationsTable.addEventListener("input", (event) => {
  if (event.target.matches("input")) {
    computeTargets();
  }
});

stationsTable.addEventListener("click", (event) => {
  if (event.target.classList.contains("remove")) {
    const row = event.target.closest(".table-row");
    if (row && stationsTable.querySelectorAll(".table-row").length > 1) {
      row.remove();
      computeTargets();
    }
  }
});

addStationButton.addEventListener("click", () => {
  addStationRow();
});

[gpxFileInput, startTimeInput, targetHoursInput, targetMinutesInput].forEach((input) => {
  input.addEventListener("input", computeTargets);
});

[manualGainInput, manualLossInput].forEach((input) => {
  input.addEventListener("input", computeTargets);
});

gpxFileInput.addEventListener("change", handleGpxUpload);

computeTargets();
