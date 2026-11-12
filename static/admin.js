const map = L.map("adminMap").setView([17.385, 78.4867], 12);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const $ = (id) => document.getElementById(id);
let pin = null;
let selected = null; // {lat, lng}

function selectPoint(lat, lng, name) {
  selected = { lat, lng };
  if (pin) pin.setLatLng([lat, lng]);
  else pin = L.marker([lat, lng]).addTo(map);
  $("coords").value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  if (name) $("placeName").value = name;
}

map.on("click", (e) => selectPoint(e.latlng.lat, e.latlng.lng));

async function search() {
  const q = $("searchBox").value.trim();
  if (!q) return;
  const box = $("searchResults");
  box.textContent = "Searching…";
  try {
    const res = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&q=" + encodeURIComponent(q));
    const data = await res.json();
    box.innerHTML = "";
    if (!data.length) { box.textContent = "No results. Try clicking on the map instead."; return; }
    data.forEach((r) => {
      const d = document.createElement("div");
      d.textContent = r.display_name;
      d.onclick = () => {
        const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
        map.setView([lat, lng], 17);
        selectPoint(lat, lng, r.name || r.display_name.split(",")[0]);
        box.innerHTML = "";
      };
      box.appendChild(d);
    });
  } catch (e) {
    box.textContent = "Search failed. Click on the map instead.";
  }
}
$("searchBtn").onclick = search;
$("searchBox").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });

$("jobForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("formMsg");
  if (!selected) { msg.textContent = "Please select a place on the map first."; return; }
  const res = await fetch("/admin/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      place_name: $("placeName").value,
      lat: selected.lat,
      lng: selected.lng,
      title: $("title").value,
      description: $("description").value,
      apply_link: $("applyLink").value,
    }),
  });
  const data = await res.json();
  if (res.ok) {
    msg.textContent = "Job uploaded ✔";
    $("title").value = ""; $("description").value = ""; $("applyLink").value = "";
    loadJobs();
  } else {
    msg.textContent = data.error || "Something went wrong";
    if (res.status === 401) location.href = "/admin/login";
  }
});

async function loadJobs() {
  const res = await fetch("/admin/api/jobs");
  if (res.status === 401) { location.href = "/admin/login"; return; }
  const jobs = await res.json();
  const body = $("jobRows");
  body.innerHTML = "";
  jobs.forEach((j) => {
    const tr = document.createElement("tr");
    [j.place_name, j.title, `${j.lat.toFixed(4)}, ${j.lng.toFixed(4)}`].forEach((t) => {
      const td = document.createElement("td");
      td.textContent = t;
      tr.appendChild(td);
    });
    const td = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "danger";
    btn.textContent = "Delete";
    btn.onclick = async () => {
      if (!confirm("Delete this job?")) return;
      await fetch(`/admin/api/jobs/${j.id}`, { method: "DELETE" });
      loadJobs();
    };
    td.appendChild(btn);
    tr.appendChild(td);
    body.appendChild(tr);
  });
}
loadJobs();