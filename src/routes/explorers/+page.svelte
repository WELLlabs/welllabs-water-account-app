<svelte:head>
	<title>Data Explorers · WELL Labs</title>
</svelte:head>

<main class="mx-auto max-w-7xl p-6">
	<header class="my-8 text-center">
		<h1 class="mb-3 text-4xl font-semibold text-[#00296b]">Data Explorers</h1>
		<p class="mx-auto max-w-2xl text-lg text-slate-500">
			A collection of explorers for data aggregated from various sources for sensemaking
		</p>
	</header>

	<div class="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
		<a
			href="/explorers/tlab"
			class="group rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-shadow hover:shadow-md"
		>
			<div
				class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-lime-100 text-lime-700 group-hover:bg-lime-600 group-hover:text-white"
			>
				<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5h16v14H4zM4 12h16M12 5v14" />
				</svg>
			</div>
			<h2 class="mb-2 text-xl font-semibold text-slate-900">Crop water estimation</h2>
			<p class="mb-4 text-sm leading-relaxed text-slate-500">
				An estimated crop water requirement for a custom boundary file. The explorer fetches farm plots in the boundary and what is being grown in them using Google's Agricultural Landscape Understanding API and calculates water estimate at a plot and boundary level
			</p>
			<span class="text-sm font-semibold text-lime-700 group-hover:text-lime-800">Open explorer →</span>
		</a>
	</div>
</main>
