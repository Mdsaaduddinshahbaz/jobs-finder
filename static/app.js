const DEFAULT_POS = [17.385, 78.4867]; // fallback: Hyderabad
const map = L.map("map").setView(DEFAULT_POS, 13);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const statusEl = document.getElementById("status");
const listEl = document.getElementById("placeList");
const panelEl = document.getElementById("jobsPanel");
const radiusEl = document.getElementById("radius");

let userMarker = null;
let userPos = DEFAULT_POS;
let markers = [];

// ---------- custom icons ----------
// the user: a little person instead of the default pin
const personIcon = L.divIcon({
  className: "person-pin",
  html: `<div class="person">
           <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
             <circle cx="16" cy="9" r="6" fill="#2563eb"/>
             <path d="M5 29c0-6.6 4.9-11 11-11s11 4.4 11 11z" fill="#2563eb"/>
           </svg>
         </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

// jobs: an orange briefcase pin, with "+N more" beside it when a place has several jobs
function jobIcon(count) {
  const more = count > 1 ? `<span class="more">+${count - 1} more</span>` : "";
  return L.divIcon({
    className: "job-pin-wrap",
    html: `<div class="job-pin"><div class="pin"></div><div class="icon">💼</div>${more}</div>`,
    iconSize: [40, 48],
    iconAnchor: [20, 48],
    tooltipAnchor: [0, -44],
  });
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function setUser(lat, lng, note) {
  userPos = [lat, lng];
  if (!userMarker) {
    userMarker = L.marker(userPos, { draggable: true, icon: personIcon, zIndexOffset: 1000 }).addTo(map);
    userMarker.on("dragend", () => {
      const p = userMarker.getLatLng();
      setUser(p.lat, p.lng, "Location set manually (click the map or drag me to change)");
    });
  } else {
    userMarker.setLatLng(userPos);
  }
  userMarker.bindTooltip("You are here (drag me or click the map)");
  statusEl.textContent = note;
  loadPlaces();
}

// clicking anywhere on the map moves the person there and reloads nearby jobs
// (clicking a job pin does not trigger this – Leaflet markers swallow the click)
map.on("click", (e) => {
  setUser(e.latlng.lat, e.latlng.lng, "Location set to the spot you clicked");
});

async function loadPlaces() {
  const res = await fetch(`/api/places?lat=${userPos[0]}&lng=${userPos[1]}&radius_km=${radiusEl.value}`);
  const places = await res.json();

  markers.forEach((m) => m.remove());
  markers = [];
  listEl.innerHTML = "";
  panelEl.classList.add("hidden");

  if (!places.length) {
    listEl.appendChild(el("li", "meta", "No jobs found within this radius."));
    return;
  }

  places.forEach((p) => {
    const li = el("li");
    const marker = L.marker([p.lat, p.lng], { icon: jobIcon(p.job_count) }).addTo(map);
    marker.bindTooltip(`${p.name} (${p.job_count} job${p.job_count > 1 ? "s" : ""})`);
    marker.on("click", () => showJobs(p.id, li));
    markers.push(marker);

    const left = el("div");
    left.appendChild(el("strong", "", p.name));
    left.appendChild(el("div", "meta", `${p.distance_km} km away`));
    li.appendChild(left);
    li.appendChild(el("span", "badge", `${p.job_count} job${p.job_count > 1 ? "s" : ""}`));
    li.addEventListener("click", () => {
      map.setView([p.lat, p.lng], 16);
      showJobs(p.id, li);
    });
    listEl.appendChild(li);
  });
}

async function showJobs(placeId, li) {
  document.querySelectorAll(".list li").forEach((x) => x.classList.remove("active"));
  if (li) li.classList.add("active");

  const res = await fetch(`/api/places/${placeId}/jobs`);
  const data = await res.json();
  panelEl.innerHTML = "";
  panelEl.classList.remove("hidden");
  panelEl.appendChild(el("h2", "", `Jobs at ${data.place.name}`));

  data.jobs.forEach((j) => {
    const card = el("div", "job");
    card.appendChild(el("h3", "", j.title));
    if (j.description) card.appendChild(el("p", "", j.description));
    if (j.apply_link) {
      const a = el("a", "", "Apply →");
      a.href = j.apply_link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      card.appendChild(a);
    }
    panelEl.appendChild(card);
  });
  panelEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

radiusEl.addEventListener("change", loadPlaces);

// ---------- live location ----------
const LABEL = "📍 Use my live location";
function setLocating(on) {
  document.querySelectorAll(".locate-btn").forEach((b) => {
    b.disabled = on;
    if (b.id === "locateBtn") b.textContent = on ? "Locating…" : LABEL;
  });
}

// can be called any time – at startup and whenever the user wants to come back to where they really are
function locateMe() {
  if (!("geolocation" in navigator)) {
    if (!userMarker) setUser(DEFAULT_POS[0], DEFAULT_POS[1], "Geolocation not supported – click the map to set where you are");
    else statusEl.textContent = "Geolocation is not supported in this browser";
    return;
  }
  setLocating(true);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setLocating(false);
      map.setView([pos.coords.latitude, pos.coords.longitude], 15);
      setUser(pos.coords.latitude, pos.coords.longitude, "Showing jobs near your live location (click the map to move)");
    },
    (err) => {
      setLocating(false);
      const msg = err.code === 1
        ? "Location permission denied – allow it in your browser's site settings and try again"
        : "Couldn't get your live location – please try again";
      if (!userMarker) setUser(DEFAULT_POS[0], DEFAULT_POS[1], msg + ". Click the map to set where you are.");
      else statusEl.textContent = msg;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// sidebar button
document.getElementById("locateBtn").addEventListener("click", locateMe);

// floating button on the map (handy on phones where the map is on top)
const LocateControl = L.Control.extend({
  options: { position: "bottomright" },
  onAdd() {
    const b = L.DomUtil.create("button", "locate-btn locate-fab");
    b.type = "button";
    b.title = "Go to my live location";
    b.textContent = "🎯";
    L.DomEvent.disableClickPropagation(b);
    b.addEventListener("click", locateMe);
    return b;
  },
});
map.addControl(new LocateControl());

locateMe();