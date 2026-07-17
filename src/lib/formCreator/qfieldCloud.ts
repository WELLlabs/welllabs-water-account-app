const BASE = 'https://app.qfield.cloud/api/v1';

export interface QfcUser {
	username: string;
	email: string;
}

export interface QfcProject {
	id: string;
	name: string;
	owner: string;
}

export class QFieldCloudError extends Error {
	constructor(
		message: string,
		public status?: number
	) {
		super(message);
		this.name = 'QFieldCloudError';
	}
}

function authHeaders(token: string): HeadersInit {
	return { Authorization: `Token ${token}` };
}

/** Verify token and return user info. Throws QFieldCloudError on invalid token. */
export async function getUser(token: string): Promise<QfcUser> {
	const res = await fetch(`${BASE}/auth/user/`, { headers: authHeaders(token) });
	if (!res.ok) {
		throw new QFieldCloudError(
			res.status === 401 || res.status === 403
				? 'Invalid or expired API token.'
				: `Failed to get user info (HTTP ${res.status}).`,
			res.status
		);
	}
	return res.json() as Promise<QfcUser>;
}

/** List projects for the authenticated user. */
export async function listProjects(token: string): Promise<QfcProject[]> {
	const res = await fetch(`${BASE}/projects/`, { headers: authHeaders(token) });
	if (!res.ok) throw new QFieldCloudError(`Failed to list projects (HTTP ${res.status}).`, res.status);
	const data = await res.json();
	// API may return array directly or paginated { results: [...] }
	return Array.isArray(data) ? data : (data.results ?? []);
}

/**
 * Create a new project. Returns the created project.
 */
export async function createProject(
	token: string,
	name: string,
	owner: string,
	description = ''
): Promise<QfcProject> {
	const res = await fetch(`${BASE}/projects/`, {
		method: 'POST',
		headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
		body: JSON.stringify({ name, description, owner, is_public: false })
	});
	if (!res.ok) {
		const body = await res.text();
		throw new QFieldCloudError(
			`Failed to create project: ${body || res.statusText} (HTTP ${res.status}).`,
			res.status
		);
	}
	return res.json() as Promise<QfcProject>;
}

/**
 * Upload a file to a QField Cloud project.
 * Reports progress via onProgress(0–100).
 */
export function uploadFile(
	token: string,
	projectId: string,
	fileName: string,
	blob: Blob,
	onProgress: (pct: number) => void
): Promise<void> {
	return new Promise((resolve, reject) => {
		const form = new FormData();
		form.append('file', blob, fileName);

		const xhr = new XMLHttpRequest();
		xhr.open('POST', `${BASE}/files/${projectId}/${encodeURIComponent(fileName)}/`);
		xhr.setRequestHeader('Authorization', `Token ${token}`);

		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
		};

		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				onProgress(100);
				resolve();
			} else {
				reject(
					new QFieldCloudError(
						`Upload failed: ${xhr.responseText || xhr.statusText} (HTTP ${xhr.status}).`,
						xhr.status
					)
				);
			}
		};

		xhr.onerror = () => reject(new QFieldCloudError('Network error during upload.'));
		xhr.send(form);
	});
}

/**
 * Full push flow:
 * 1. Verify token / get username
 * 2. Create project (or reuse existing one with same name)
 * 3. Upload QGZ
 *
 * onStep(message, pct) is called with progress updates.
 */
export async function pushToQFieldCloud(
	token: string,
	projectName: string,
	qgzBlob: Blob,
	qgzFileName: string,
	onStep: (msg: string, pct: number) => void
): Promise<{ projectId: string; projectUrl: string }> {
	onStep('Verifying token…', 5);
	const user = await getUser(token);

	onStep('Checking existing projects…', 20);
	const projects = await listProjects(token);
	let project = projects.find(
		(p) => p.name === projectName && p.owner === user.username
	);

	if (!project) {
		onStep('Creating project…', 35);
		project = await createProject(token, projectName, user.username);
	} else {
		onStep('Project found, uploading…', 35);
	}

	onStep('Uploading QGZ…', 40);
	await uploadFile(token, project.id, qgzFileName, qgzBlob, (pct) => {
		onStep(`Uploading… ${pct}%`, 40 + Math.round(pct * 0.55));
	});

	const projectUrl = `https://app.qfield.cloud/a/${user.username}/${project.name}/`;
	onStep('Done!', 100);
	return { projectId: project.id, projectUrl };
}
