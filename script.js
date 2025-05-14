const hourHand = document.querySelector('[data-hour-hand]');
const minuteHand = document.querySelector('[data-minute-hand]');
const secondHand = document.querySelector('[data-second-hand]');
const dateDisplay = document.getElementById('date-display');
const clockContainer = document.querySelector('.clock-container');
const prayerRing = document.querySelector('.prayer-ring');
const prayerTimeInfo = document.getElementById('prayer-time-info');
const simulateYearBtn = document.getElementById('simulateYearBtn');
const simulationStatus = document.getElementById('simulation-status');

const numbersToDisplay = [0, 3, 6, 9, 12, 15, 18, 21];
const numberRadiusPercentage = 40;

let prayerScheduleForGradient = [];

const CACHE_KEY_LOCATION = 'prayerClock_location';
const CACHE_KEY_PRAYER_TIMES = 'prayerClock_prayerTimes';
const CACHE_KEY_TIMESTAMP = 'prayerClock_timestamp';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

const CACHE_KEY_YEARLY_PRAYER_TIMES = 'prayerClock_yearlyPrayerTimes';
const CACHE_KEY_YEARLY_SIM_START_DATE = 'prayerClock_yearlySimStartDate';
const CACHE_KEY_LAST_GEOLOCATED_COORDS = 'prayerClock_location_coords';

let isSimulating = false;
let isSimulatingReverse = false;
let yearlyPrayerData = null;
let currentSimulationDayIndex = 0;
let simulationIntervalId = null;
let reverseSimulationIntervalId = null;
var allYearData; // For fetchPrayerTimes delay check

function setupClockFace() {
	try {
		clockContainer
			.querySelectorAll('.clock-number, .marker')
			.forEach(el => el.remove());
		numbersToDisplay.forEach(hour => {
			const numberDiv = document.createElement('div');
			numberDiv.classList.add('clock-number');
			numberDiv.textContent = hour;
			const angleDegreesNum = (hour / 24) * 360;
			const angleRadiansNum = angleDegreesNum * (Math.PI / 180);
			const xPos = 50 + numberRadiusPercentage * Math.sin(angleRadiansNum);
			const yPos = 50 - numberRadiusPercentage * Math.cos(angleRadiansNum);
			numberDiv.style.left = `${xPos}%`;
			numberDiv.style.top = `${yPos}%`;
			clockContainer.appendChild(numberDiv);
		});
		for (let i = 0; i < 24; i++) {
			if (!numbersToDisplay.includes(i)) {
				const markerDiv = document.createElement('div');
				markerDiv.classList.add('marker');
				markerDiv.style.transform = `rotate(${i * 15}deg)`;
				if (i % 6 === 0) markerDiv.classList.add('cardinal');
				else markerDiv.classList.add('minor');
				clockContainer.appendChild(markerDiv);
			}
		}
	} catch (e) {
		console.error('Error in setupClockFace:', e);
	}
}

function setRotation(element, rotationDegrees) {
	if (element) {
		element.style.transform = `translateX(-50%) rotate(${rotationDegrees}deg)`;
	}
}

function setClock() {
	try {
		const currentDate = new Date();
		if (!isSimulating && !isSimulatingReverse) {
			const options = {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			};
			dateDisplay.textContent = currentDate.toLocaleDateString(
				undefined,
				options
			);
		}
		const seconds = currentDate.getSeconds();
		const minutes = currentDate.getMinutes();
		const hours = currentDate.getHours();
		const secondsRatio = seconds / 60;
		const minutesRatio = (secondsRatio + minutes) / 60;
		const hoursRatio = (minutesRatio + hours) / 24;
		const secondsDegrees = secondsRatio * 360;
		const minutesDegrees = minutesRatio * 360;
		const hoursDegrees = hoursRatio * 360;
		setRotation(secondHand, secondsDegrees);
		setRotation(minuteHand, minutesDegrees);
		setRotation(hourHand, hoursDegrees);
	} catch (e) {
		console.error('Error in setClock:', e);
	}
}

async function fetchPrayerTimes(latitude, longitude, dateString, method = 4) {
	const url = `https://api.aladhan.com/v1/timings/${dateString}?latitude=${latitude}&longitude=${longitude}&method=${method}`;
	try {
		const response = await fetch(url);
		if (
			isSimulating &&
			typeof allYearData !== 'undefined' &&
			allYearData &&
			allYearData.length < 365
		) {
			await new Promise(resolve => setTimeout(resolve, 60));
		}
		if (!response.ok) {
			console.error(
				`API error for ${dateString}: ${response.status} ${response.statusText}`
			);
			return null;
		}
		const data = await response.json();
		if (data.code === 200) return data.data.timings;

		console.error(`API data error for ${dateString}:`, data.status);
		return null;
	} catch (error) {
		console.error(`Error fetching prayer times for ${dateString}:`, error);
		return null;
	}
}

function timeToAngle(timeStr) {
	if (!timeStr) return 0;
	const [hours, minutes] = timeStr.split(':').map(Number);
	if (isNaN(hours) || isNaN(minutes)) return 0;
	const totalMinutesInDay = 24 * 60;
	const prayerTotalMinutes = hours * 60 + minutes;
	const angleRatio = prayerTotalMinutes / totalMinutesInDay;
	return angleRatio * 360;
}

function positionPrayerMarker(timeStr, prayerName) {
	if (!timeStr) return;
	try {
		const angleDegrees = timeToAngle(timeStr);
		prayerScheduleForGradient.push({
			name: prayerName,
			time: timeStr,
			angle: angleDegrees,
		});

		const marker = document.createElement('div');
		marker.classList.add('prayer-marker', prayerName.toLowerCase());
		marker.title = `${prayerName}: ${timeStr}`;

		const radiusPercentForMarkerCenter = 48;
		const xPos =
			50 +
			radiusPercentForMarkerCenter * Math.sin((angleDegrees * Math.PI) / 180);
		const yPos =
			50 -
			radiusPercentForMarkerCenter * Math.cos((angleDegrees * Math.PI) / 180);

		marker.style.left = `${xPos}%`;
		marker.style.top = `${yPos}%`;
		marker.style.transform = `translate(-50%, -50%)`;

		prayerRing.appendChild(marker);
	} catch (e) {
		console.error(`Error in positionPrayerMarker for ${prayerName}:`, e);
	}
}

async function reverseGeocode(latitude, longitude) {
	const userAgent = 'PrayerClockApp/1.0 (your-email@example.com)';
	const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&accept-language=en`;
	try {
		const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
		if (!response.ok) {
			console.warn(
				`Reverse geocoding API error: ${response.status} ${response.statusText}`
			);
			return null;
		}
		const data = await response.json();
		if (data && data.address) {
			return (
				data.address.city ||
				data.address.town ||
				data.address.village ||
				data.address.county ||
				data.address.state ||
				data.address.country ||
				null
			);
		}
		console.warn('Reverse geocoding: No address found in response', data);
		return null;
	} catch (error) {
		console.warn('Error during reverse geocoding fetch:', error);
		return null;
	}
}

function applyPrayerRingSegmentsSVG() {
	if (prayerScheduleForGradient.length < 5) {
		prayerRing.style.backgroundImage = 'none';
		return;
	}
	prayerScheduleForGradient.sort((a, b) => a.angle - b.angle);

	const rootStyles = getComputedStyle(document.documentElement);
	const segmentColors = [
		rootStyles.getPropertyValue('--color-segment-1').trim(),
		rootStyles.getPropertyValue('--color-segment-2').trim(),
		rootStyles.getPropertyValue('--color-segment-3').trim(),
		rootStyles.getPropertyValue('--color-segment-4').trim(),
		rootStyles.getPropertyValue('--color-segment-5').trim(),
	];

	const prayers = prayerScheduleForGradient;
	const svgSize = 200;
	const center = svgSize / 2;
	const radius = svgSize / 2;
	let svgPaths = '';

	function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
		const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
		return {
			x: centerX + radius * Math.cos(angleInRadians),
			y: centerY + radius * Math.sin(angleInRadians),
		};
	}

	const segmentsData = [
		{
			startAngle: prayers.find(p => p.name === 'Isha').angle,
			endAngle: prayers.find(p => p.name === 'Fajr').angle,
			color: segmentColors[0],
		},
		{
			startAngle: prayers.find(p => p.name === 'Fajr').angle,
			endAngle: prayers.find(p => p.name === 'Dhuhr').angle,
			color: segmentColors[1],
		},
		{
			startAngle: prayers.find(p => p.name === 'Dhuhr').angle,
			endAngle: prayers.find(p => p.name === 'Asr').angle,
			color: segmentColors[2],
		},
		{
			startAngle: prayers.find(p => p.name === 'Asr').angle,
			endAngle: prayers.find(p => p.name === 'Maghrib').angle,
			color: segmentColors[3],
		},
		{
			startAngle: prayers.find(p => p.name === 'Maghrib').angle,
			endAngle: prayers.find(p => p.name === 'Isha').angle,
			color: segmentColors[4],
		},
	];

	segmentsData.forEach(segment => {
		let startAngle = segment.startAngle;
		let endAngle = segment.endAngle;
		let effStartAngle = ((startAngle % 360) + 360) % 360;
		let effEndAngle = ((endAngle % 360) + 360) % 360;
		if (effEndAngle === 0 && endAngle > 0) effEndAngle = 360;

		if (segment.color === segmentColors[0]) {
			if (
				effStartAngle > effEndAngle ||
				(effStartAngle === 0 && effEndAngle === 0 && startAngle > endAngle)
			) {
				let start1 = polarToCartesian(center, center, radius, effStartAngle);
				let end1 = polarToCartesian(center, center, radius, 359.999);
				let arcSweep1 = 359.999 - effStartAngle <= 180 ? '0' : '1';
				if (effStartAngle >= 359.999 || effStartAngle < 0.001) arcSweep1 = '0';
				svgPaths += `<path d="M ${center} ${center} L ${start1.x} ${start1.y} A ${radius} ${radius} 0 ${arcSweep1} 1 ${end1.x} ${end1.y} Z" fill="${segment.color}" />`;

				let start2 = polarToCartesian(center, center, radius, 0);
				let end2 = polarToCartesian(center, center, radius, effEndAngle);
				let arcSweep2 = effEndAngle <= 180 ? '0' : '1';
				if (effEndAngle < 0.001 && effStartAngle !== 0) arcSweep2 = '0';
				svgPaths += `<path d="M ${center} ${center} L ${start2.x} ${start2.y} A ${radius} ${radius} 0 ${arcSweep2} 1 ${end2.x} ${end2.y} Z" fill="${segment.color}" />`;
			} else {
				const start = polarToCartesian(center, center, radius, effStartAngle);
				const end = polarToCartesian(center, center, radius, effEndAngle);
				const largeArcFlag =
					(effEndAngle - effStartAngle + 360) % 360 > 180 ? '1' : '0';
				const pathData = `M ${center} ${center} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
				svgPaths += `<path d="${pathData}" fill="${segment.color}" />`;
			}
		} else {
			const start = polarToCartesian(center, center, radius, effStartAngle);
			const end = polarToCartesian(center, center, radius, effEndAngle);
			const largeArcFlag =
				(effEndAngle - effStartAngle + 360) % 360 > 180 ? '1' : '0';
			const pathData = `M ${center} ${center} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
			svgPaths += `<path d="${pathData}" fill="${segment.color}" />`;
		}
	});

	const svgString = `<svg viewBox="0 0 ${svgSize} ${svgSize}" xmlns="http://www.w3.org/2000/svg">${svgPaths}</svg>`;
	const dataUrl = `url("data:image/svg+xml,${encodeURIComponent(svgString)}")`;

	prayerRing.style.backgroundImage = dataUrl;
	prayerRing.style.backgroundRepeat = 'no-repeat';
	prayerRing.style.backgroundPosition = 'center';
	prayerRing.style.backgroundSize = 'contain';
}

function saveDataToCache(locationName, prayerTimes, dateString) {
	try {
		localStorage.setItem(CACHE_KEY_LOCATION, locationName);
		localStorage.setItem(CACHE_KEY_PRAYER_TIMES, JSON.stringify(prayerTimes));
		localStorage.setItem(
			CACHE_KEY_TIMESTAMP,
			JSON.stringify({ timestamp: Date.now(), date: dateString })
		);
	} catch (e) {
		console.warn('Error saving to localStorage:', e);
	}
}

function loadDataFromCache(currentDateString) {
	try {
		const cachedTimestampStr = localStorage.getItem(CACHE_KEY_TIMESTAMP);
		if (!cachedTimestampStr) return null;
		const cachedTimestampData = JSON.parse(cachedTimestampStr);
		if (
			Date.now() - cachedTimestampData.timestamp > CACHE_DURATION_MS ||
			cachedTimestampData.date !== currentDateString
		) {
			localStorage.removeItem(CACHE_KEY_LOCATION);
			localStorage.removeItem(CACHE_KEY_PRAYER_TIMES);
			localStorage.removeItem(CACHE_KEY_TIMESTAMP);
			return null;
		}
		const locationName = localStorage.getItem(CACHE_KEY_LOCATION);
		const prayerTimesStr = localStorage.getItem(CACHE_KEY_PRAYER_TIMES);
		if (locationName && prayerTimesStr) {
			return {
				locationDisplayName: locationName,
				timings: JSON.parse(prayerTimesStr),
				dateString: cachedTimestampData.date,
			};
		}
		return null;
	} catch (e) {
		console.warn('Error loading from localStorage:', e);
		return null;
	}
}

async function fetchYearlyPrayerTimes(latitude, longitude, startDate) {
	isSimulating = true;
	simulateYearBtn.disabled = true;
	simulationStatus.textContent =
		'Fetching yearly prayer times (this may take a few minutes)... 0/365';

	allYearData = [];
	let currentFetchDate = new Date(startDate.getTime());

	for (let i = 0; i < 365; i++) {
		const day = String(currentFetchDate.getDate()).padStart(2, '0');
		const month = String(currentFetchDate.getMonth() + 1).padStart(2, '0');
		const year = currentFetchDate.getFullYear();
		const dateStringToFetch = `${day}-${month}-${year}`;

		const dailyTimings = await fetchPrayerTimes(
			latitude,
			longitude,
			dateStringToFetch
		);
		allYearData.push({
			date: new Date(currentFetchDate.getTime()),
			timings: dailyTimings,
		});

		simulationStatus.textContent = `Fetching yearly prayer times... ${
			i + 1
		}/365`;
		currentFetchDate.setDate(currentFetchDate.getDate() + 1);
	}
	simulationStatus.textContent = 'Yearly prayer times fetched!';
	return allYearData;
}

function saveYearlyDataToCache(data, simulationStartDate) {
	try {
		localStorage.setItem(
			CACHE_KEY_YEARLY_PRAYER_TIMES,
			JSON.stringify(
				data.map(day => ({
					date: day.date.toISOString(),
					timings: day.timings,
				}))
			)
		);
		localStorage.setItem(
			CACHE_KEY_YEARLY_SIM_START_DATE,
			simulationStartDate.toISOString().split('T')[0]
		);
		console.log('Yearly data saved to cache.');
	} catch (e) {
		console.warn('Error saving yearly data to localStorage:', e);
		simulationStatus.textContent =
			'Error saving yearly data. May be too large for localStorage.';
	}
}

function loadYearlyDataFromCache(simulationStartDate) {
	try {
		const cachedSimStartDate = localStorage.getItem(
			CACHE_KEY_YEARLY_SIM_START_DATE
		);
		const currentSimStartDateStr = simulationStartDate
			.toISOString()
			.split('T')[0];

		if (!cachedSimStartDate || cachedSimStartDate !== currentSimStartDateStr) {
			console.log('Yearly cache is for a different start date or missing.');
			localStorage.removeItem(CACHE_KEY_YEARLY_PRAYER_TIMES);
			localStorage.removeItem(CACHE_KEY_YEARLY_SIM_START_DATE);
			return null;
		}

		const yearlyDataStr = localStorage.getItem(CACHE_KEY_YEARLY_PRAYER_TIMES);
		if (yearlyDataStr) {
			const parsedData = JSON.parse(yearlyDataStr);
			console.log('Yearly data loaded from cache.');
			return parsedData.map(day => ({
				date: new Date(day.date),
				timings: day.timings,
			}));
		}
		return null;
	} catch (e) {
		console.warn('Error loading yearly data from localStorage:', e);
		return null;
	}
}

function updateUIForDay(dayData) {
	const options = {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	};
	dateDisplay.textContent = dayData.date.toLocaleDateString(undefined, options);

	prayerRing.innerHTML = '';
	prayerScheduleForGradient = [];

	if (dayData.timings) {
		prayerTimeInfo.innerHTML = `Prayer times for <strong>${dayData.date.toLocaleDateString(
			undefined,
			{ month: 'long', day: 'numeric' }
		)}</strong>:<br>F: ${dayData.timings.Fajr}, D: ${
			dayData.timings.Dhuhr
		}, A: ${dayData.timings.Asr}, M: ${dayData.timings.Maghrib}, I: ${
			dayData.timings.Isha
		}`;

		positionPrayerMarker(dayData.timings.Fajr, 'Fajr');
		positionPrayerMarker(dayData.timings.Dhuhr, 'Dhuhr');
		positionPrayerMarker(dayData.timings.Asr, 'Asr');
		positionPrayerMarker(dayData.timings.Maghrib, 'Maghrib');
		positionPrayerMarker(dayData.timings.Isha, 'Isha');
		applyPrayerRingSegmentsSVG();
	} else {
		prayerTimeInfo.innerHTML = `No prayer times for <strong>${dayData.date.toLocaleDateString(
			undefined,
			{ month: 'long', day: 'numeric' }
		)}</strong>.`;
		prayerRing.style.backgroundImage = 'none';
	}
}

function runReverseSimulationStep() {
	if (currentSimulationDayIndex < 0) {
		clearInterval(reverseSimulationIntervalId);
		reverseSimulationIntervalId = null;
		isSimulatingReverse = false;
		simulateYearBtn.disabled = false;
		simulateYearBtn.textContent = 'Simulate Year of Prayer Times';
		simulationStatus.textContent = 'Yearly simulation rewind complete!';
		initPrayerTimes(true);
		return;
	}

	const currentDayData = yearlyPrayerData[currentSimulationDayIndex];
	simulationStatus.textContent = `Rewinding: Day ${
		currentSimulationDayIndex + 1
	}/365 (${currentDayData.date.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
	})})`;
	updateUIForDay(currentDayData);
	currentSimulationDayIndex--;
}

function runSimulationStep() {
	if (currentSimulationDayIndex >= yearlyPrayerData.length) {
		clearInterval(simulationIntervalId);
		simulationIntervalId = null;

		simulationStatus.textContent = 'Forward simulation complete. Pausing...';

		setTimeout(() => {
			if (!isSimulating && !isSimulatingReverse) {
				initPrayerTimes(true);
				return;
			}

			isSimulating = false;
			isSimulatingReverse = true;
			simulationStatus.textContent = 'Starting rewind...';
			currentSimulationDayIndex = yearlyPrayerData.length - 1;

			if (reverseSimulationIntervalId)
				clearInterval(reverseSimulationIntervalId);
			runReverseSimulationStep();
			reverseSimulationIntervalId = setInterval(runReverseSimulationStep, 5); // REVERSE SPEED
		}, 1000);

		return;
	}

	const currentDayData = yearlyPrayerData[currentSimulationDayIndex];
	simulationStatus.textContent = `Simulating: Day ${
		currentSimulationDayIndex + 1
	}/365 (${currentDayData.date.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
	})})`;
	updateUIForDay(currentDayData);
	currentSimulationDayIndex++;
}

async function simulateYear() {
	if (isSimulating || isSimulatingReverse) {
		clearInterval(simulationIntervalId);
		simulationIntervalId = null;
		clearInterval(reverseSimulationIntervalId);
		reverseSimulationIntervalId = null;

		isSimulating = false;
		isSimulatingReverse = false;
		simulateYearBtn.disabled = false;
		simulateYearBtn.textContent = 'Simulate Year of Prayer Times';
		simulationStatus.textContent = 'Simulation stopped.';
		initPrayerTimes(true);
		return;
	}

	const simulationStartDate = new Date();
	simulationStartDate.setHours(0, 0, 0, 0);

	yearlyPrayerData = loadYearlyDataFromCache(simulationStartDate);

	if (!yearlyPrayerData) {
		let latForYear = 21.4225,
			lonForYear = 39.8262;
		try {
			const cachedLocationDataStr = localStorage.getItem(
				CACHE_KEY_LAST_GEOLOCATED_COORDS
			); // Using the correct key
			if (cachedLocationDataStr) {
				const coords = JSON.parse(cachedLocationDataStr);
				latForYear = coords.lat;
				lonForYear = coords.lon;
				console.log(
					'Using cached coords for yearly fetch:',
					latForYear,
					lonForYear
				);
			}
		} catch (e) {
			console.warn(
				'Could not parse cached coords, using default for yearly fetch.',
				e
			);
		}

		yearlyPrayerData = await fetchYearlyPrayerTimes(
			latForYear,
			lonForYear,
			simulationStartDate
		);
		if (
			yearlyPrayerData &&
			yearlyPrayerData.length > 0 &&
			yearlyPrayerData.every(d => d !== undefined)
		) {
			saveYearlyDataToCache(yearlyPrayerData, simulationStartDate);
		} else {
			simulationStatus.textContent =
				'Failed to fetch complete yearly data. Please try again.';
			isSimulating = false;
			simulateYearBtn.disabled = false;
			return;
		}
	} else {
		simulationStatus.textContent =
			'Loaded yearly data from cache. Starting simulation...';
	}

	if (!yearlyPrayerData || yearlyPrayerData.length === 0) {
		simulationStatus.textContent = 'No yearly data available to simulate.';
		isSimulating = false;
		simulateYearBtn.disabled = false;
		return;
	}

	isSimulating = true;
	isSimulatingReverse = false;
	simulateYearBtn.textContent = 'Stop Simulation';
	currentSimulationDayIndex = 0;

	if (simulationIntervalId) clearInterval(simulationIntervalId);
	if (reverseSimulationIntervalId) clearInterval(reverseSimulationIntervalId);

	runSimulationStep();
	simulationIntervalId = setInterval(runSimulationStep, 200); // FORWARD SPEED
}

simulateYearBtn.addEventListener('click', simulateYear);

async function initPrayerTimes(isPostSimulationRefresh = false) {
	if ((isSimulating || isSimulatingReverse) && !isPostSimulationRefresh) return;

	prayerRing.innerHTML = '';
	prayerScheduleForGradient = [];

	const today = new Date();
	const day = String(today.getDate()).padStart(2, '0');
	const month = String(today.getMonth() + 1).padStart(2, '0');
	const year = today.getFullYear();
	const currentDateString = `${day}-${month}-${year}`;

	let locationDisplayName = 'Mecca (Default)';
	let timings = null;
	let usingCache = false;
	let lat = 21.4225,
		lon = 39.8262;

	if (!isPostSimulationRefresh) {
		const cachedData = loadDataFromCache(currentDateString);
		if (cachedData) {
			locationDisplayName = cachedData.locationDisplayName;
			timings = cachedData.timings;
			usingCache = true;
		}
	}

	if (!timings) {
		usingCache = false;
		if (
			!isPostSimulationRefresh &&
			!prayerTimeInfo.textContent.toLowerCase().includes('error')
		) {
			prayerTimeInfo.textContent = 'Attempting to get your location...';
		}

		if (navigator.geolocation) {
			try {
				const position = await new Promise((resolve, reject) => {
					navigator.geolocation.getCurrentPosition(resolve, reject, {
						timeout: 12000,
						enableHighAccuracy: false,
					});
				});
				lat = position.coords.latitude;
				lon = position.coords.longitude;

				try {
					localStorage.setItem(
						CACHE_KEY_LAST_GEOLOCATED_COORDS,
						JSON.stringify({ lat, lon })
					);
				} catch (e) {
					console.warn('Failed to cache geolocated coords', e);
				}

				if (!isPostSimulationRefresh)
					prayerTimeInfo.textContent = `Location acquired. Looking up place name...`;
				const placeName = await reverseGeocode(lat, lon);
				if (placeName) {
					locationDisplayName = placeName;
				} else {
					locationDisplayName = `Lat: ${lat.toFixed(2)}, Lon: ${lon.toFixed(
						2
					)}`;
				}
			} catch (geoError) {
				let errorMsg = 'Geolocation failed';
				if (geoError.code === 1) errorMsg = 'Geolocation permission denied';
				else if (geoError.code === 2)
					errorMsg = 'Geolocation position unavailable';
				else if (geoError.code === 3) errorMsg = 'Geolocation timed out';
				if (!isPostSimulationRefresh)
					prayerTimeInfo.textContent = `${errorMsg}. Using prayer times for ${locationDisplayName}.`;
			}
		} else {
			if (!isPostSimulationRefresh)
				prayerTimeInfo.textContent = `Geolocation not supported. Using prayer times for ${locationDisplayName}.`;
		}

		if (!isPostSimulationRefresh || (isPostSimulationRefresh && !timings)) {
			prayerTimeInfo.innerHTML = `Fetching prayer times for <strong>${locationDisplayName}</strong>...`;
		}
		timings = await fetchPrayerTimes(lat, lon, currentDateString);

		if (timings && !isPostSimulationRefresh) {
			saveDataToCache(locationDisplayName, timings, currentDateString);
		}
	}

	if (timings) {
		let infoText = `Prayer times for <strong>${locationDisplayName}</strong>`;
		if (usingCache && !isPostSimulationRefresh) {
			infoText += ' (from cache)';
		}
		infoText += `:<br>F: ${timings.Fajr}, D: ${timings.Dhuhr}, A: ${timings.Asr}, M: ${timings.Maghrib}, I: ${timings.Isha}`;
		prayerTimeInfo.innerHTML = infoText;

		if (!isSimulating && !isSimulatingReverse) {
			const options = {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			};
			dateDisplay.textContent = today.toLocaleDateString(undefined, options);
		}

		positionPrayerMarker(timings.Fajr, 'Fajr');
		positionPrayerMarker(timings.Dhuhr, 'Dhuhr');
		positionPrayerMarker(timings.Asr, 'Asr');
		positionPrayerMarker(timings.Maghrib, 'Maghrib');
		positionPrayerMarker(timings.Isha, 'Isha');

		applyPrayerRingSegmentsSVG();
	} else {
		prayerRing.style.backgroundImage = 'none';
		if (
			!prayerTimeInfo.textContent
				.toLowerCase()
				.includes('error fetching prayer times') &&
			!prayerTimeInfo.textContent
				.toLowerCase()
				.includes('using prayer times for') &&
			!prayerTimeInfo.textContent.toLowerCase().includes('geolocation failed')
		) {
			prayerTimeInfo.innerHTML = `Could not retrieve prayer times for <strong>${locationDisplayName}</strong>.`;
		}
	}

	if (isPostSimulationRefresh) {
		simulateYearBtn.textContent = 'Simulate Year of Prayer Times';
		simulateYearBtn.disabled = false;
	}
}

try {
	setupClockFace();
	setClock();
	initPrayerTimes();
	setInterval(setClock, 1000);
} catch (e) {
	console.error('Critical error during initial setup:', e);
	document.body.innerHTML = `<p style="color:red; font-size:1.2em; text-align:center; padding:20px;">A critical error occurred: ${e.message}. Please check the console.</p>`;
}
