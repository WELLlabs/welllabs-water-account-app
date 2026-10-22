import { monthRange, yearRange, type EtPoint, type WaporProduct } from './tlab';

export type WaporTemporal = 'month' | 'year';

function errorMessage(status: number, body: unknown): string {
	const detail = (body as { detail?: unknown })?.detail;
	if (typeof detail === 'string') return detail;
	return `Request failed (${status})`;
}

/** Live WaPOR overlay: latest period, cell series (polls until the server cache is warm). */
export class TLabWaporLayer {
	readonly product: WaporProduct;
	readonly temporal: WaporTemporal;

	range = $state<{ first: string; latest: string } | null>(null);
	rangeError = $state<string | null>(null);
	idx = $state(0);
	opacity = $state(0.7);
	series = $state.raw<EtPoint[] | null>(null);
	seriesLoading = $state(false);
	seriesError = $state<string | null>(null);

	private seriesKey = '';
	private ctrl: AbortController | null = null;

	constructor(product: WaporProduct, temporal: WaporTemporal) {
		this.product = product;
		this.temporal = temporal;
	}

	periods = $derived.by(() => {
		if (!this.range) return [];
		return this.temporal === 'year'
			? yearRange(this.range.first, this.range.latest)
			: monthRange(this.range.first, this.range.latest);
	});
	period = $derived(this.periods[this.idx] ?? null);
	cellValue = $derived.by(() => {
		const p = this.period;
		if (!p || !this.series) return null;
		return this.series.find((x) => x.month === p) ?? null;
	});

	step(delta: number) {
		this.idx = Math.min(this.periods.length - 1, Math.max(0, this.idx + delta));
	}

	async loadLatest() {
		try {
			const res = await fetch(`/fwa-api/hydro/wapor/latest?product=${this.product}`, { cache: 'no-store' });
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(errorMessage(res.status, body));
			this.range = body;
			const n = this.temporal === 'year' ? yearRange(body.first, body.latest).length : monthRange(body.first, body.latest).length;
			this.idx = Math.max(0, n - 1);
		} catch (e) {
			this.rangeError = e instanceof Error ? e.message : String(e);
		}
	}

	startSeries(lat: number, lng: number) {
		const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
		if (key === this.seriesKey) return;
		this.seriesKey = key;
		void this.loadSeries(lat, lng);
	}

	stopSeries(clearKey = true) {
		this.ctrl?.abort();
		if (clearKey) this.seriesKey = '';
		this.series = null;
		this.seriesLoading = false;
	}

	abort() {
		this.ctrl?.abort();
	}

	private async loadSeries(lat: number, lng: number) {
		this.ctrl?.abort();
		const ctrl = new AbortController();
		this.ctrl = ctrl;
		this.seriesLoading = true;
		this.seriesError = null;
		this.series = null;
		const first = this.range?.first;
		const latest = this.range?.latest;
		if (!first || !latest) {
			this.seriesLoading = false;
			return;
		}
		try {
			const params = new URLSearchParams({
				product: this.product,
				lat: lat.toFixed(5),
				lng: lng.toFixed(5),
				start: first,
				end: latest
			});
			while (!ctrl.signal.aborted) {
				const res = await fetch(`/fwa-api/hydro/wapor/series?${params}`, {
					signal: ctrl.signal,
					cache: 'no-store'
				});
				const body = await res.json().catch(() => null);
				if (!res.ok) throw new Error(errorMessage(res.status, body));
				if (this.ctrl !== ctrl) return;
				const series = body.series as EtPoint[];
				this.series = series;
				if (this.idx === this.periods.length - 1) {
					const lastOk = [...series].reverse().find((p) => p.value != null);
					const idx = lastOk ? this.periods.indexOf(lastOk.month) : -1;
					if (idx >= 0) this.idx = idx;
				}
				if (body.complete) break;
				await new Promise<void>((resolve, reject) => {
					const t = setTimeout(resolve, 2000);
					ctrl.signal.addEventListener(
						'abort',
						() => {
							clearTimeout(t);
							reject(new DOMException('Aborted', 'AbortError'));
						},
						{ once: true }
					);
				});
			}
		} catch (e) {
			if (ctrl.signal.aborted) return;
			this.seriesError = e instanceof Error ? e.message : String(e);
			this.seriesKey = '';
		} finally {
			if (this.ctrl === ctrl) this.seriesLoading = false;
		}
	}
}
