<main class="mx-auto max-w-7xl p-6">
	<header class="my-8 text-center">
		<h1 class="mb-3 text-4xl font-semibold text-slate-900">Farm Water Accounting</h1>
		<p class="mx-auto max-w-2xl text-lg text-slate-500">
			Two tools for farm water management: create QField-ready survey forms, or visualize and
			analyze collected data with water budget calculations.
		</p>
	</header>

	<div class="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
		<a
			href="/create"
			class="group rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-shadow hover:shadow-md"
		>
			<div
				class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600 group-hover:bg-blue-600 group-hover:text-white"
			>
				<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
					/>
				</svg>
			</div>
			<h2 class="mb-2 text-xl font-semibold text-slate-900">Form Creator</h2>
			<p class="mb-4 text-sm leading-relaxed text-slate-500">
				Draw plot boundaries on a map, configure farmer and crop survey fields with lateral/FIC
				lookups, choose a basemap, and export a <code class="rounded bg-slate-100 px-1">.qgz</code>
				project for data collection in QField.
			</p>
			<span class="text-sm font-semibold text-blue-600 group-hover:text-blue-700"
				>Open form creator →</span
			>
		</a>

		<a
			href="/visualize"
			class="group rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-shadow hover:shadow-md"
		>
			<div
				class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white"
			>
				<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
					/>
				</svg>
			</div>
			<h2 class="mb-2 text-xl font-semibold text-slate-900">Visualization Tool</h2>
			<p class="mb-4 text-sm leading-relaxed text-slate-500">
				Upload a GeoPackage collected from the field, map columns to crop and area data, view plots
				on an interactive map, and export water budget reports as GPKG, CSV, or PDF.
			</p>
			<span class="text-sm font-semibold text-emerald-600 group-hover:text-emerald-700"
				>Open visualization →</span
			>
		</a>
	</div>
</main>
