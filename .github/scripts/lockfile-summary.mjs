// Summarise which packages changed in the package-lock.json files of a pull request.
// Env: BASE_REF (git ref to compare against), PR_NUMBER, GH_REPO, GH_TOKEN, DRY_RUN (print instead of posting)
import {execFileSync} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';

const MARKER = '<!-- lockfile-summary -->';
const MAX_ROWS = 40;
const {BASE_REF, PR_NUMBER, GH_REPO, DRY_RUN} = process.env;

const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});

// name -> Set(versions) from a lockfile (v2/v3 `packages`, v1 `dependencies`)
function versions(lock) {
	const map = new Map();
	const add = (name, version) => {
		if (!name || !version) {
			return;
		}

		if (!map.has(name)) {
			map.set(name, new Set());
		}

		map.get(name).add(version);
	};

	if (lock.packages) {
		for (const [path, meta] of Object.entries(lock.packages)) {
			if (path.includes('node_modules/')) {
				add(path.split('node_modules/').pop(), meta.version);
			}
		}
	} else {
		const walk = deps => {
			for (const [name, meta] of Object.entries(deps ?? {})) {
				add(name, meta.version);
				walk(meta.dependencies);
			}
		};

		walk(lock.dependencies);
	}

	return map;
}

const major = v => Number.parseInt(v.split('.')[0], 10);
const list = set => [...set].sort().join(', ');

function diff(baseLock, headLock) {
	const before = versions(baseLock);
	const after = versions(headLock);
	const updated = [];
	const added = [];
	const removed = [];

	for (const name of new Set([...before.keys(), ...after.keys()])) {
		const b = before.get(name) ?? new Set();
		const a = after.get(name) ?? new Set();
		const gone = new Set([...b].filter(v => !a.has(v)));
		const came = new Set([...a].filter(v => !b.has(v)));
		if (gone.size === 0 && came.size === 0) {
			continue;
		}

		if (gone.size > 0 && came.size > 0) {
			const isMajor = gone.size === 1 && came.size === 1 && major([...gone][0]) !== major([...came][0]);
			updated.push({name, text: `${list(gone)} → ${list(came)}${isMajor ? ' ⚠️ major' : ''}`});
		} else if (came.size > 0) {
			added.push({name, text: `added ${list(came)}`});
		} else {
			removed.push({name, text: `removed ${list(gone)}`});
		}
	}

	const byName = (x, y) => x.name.localeCompare(y.name);
	return {updated: updated.sort(byName), added: added.sort(byName), removed: removed.sort(byName)};
}

const files = git('diff', '--name-only', `${BASE_REF}...HEAD`, '--', '*package-lock.json').split('\n').filter(Boolean);
let body = `${MARKER}\n### Lockfile changes\n`;

if (files.length === 0) {
	body += '\nNo `package-lock.json` changes.\n';
}

for (const file of files) {
	let baseLock = {};
	try {
		baseLock = JSON.parse(git('show', `${BASE_REF}:${file}`));
	} catch {}

	const headLock = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
	const {updated, added, removed} = diff(baseLock, headLock);
	const rows = [...updated, ...added, ...removed];
	body += `\n**\`${file}\`**: ${updated.length} updated, ${added.length} added, ${removed.length} removed.\n`;
	if (rows.length === 0) {
		body += '\nNo resolved version changes (lockfile metadata only).\n';
		continue;
	}

	const table = items => `| Package | Change |\n|---|---|\n${items.map(r => `| \`${r.name}\` | ${r.text} |`).join('\n')}\n`;
	body += `\n${table(rows.slice(0, MAX_ROWS))}`;
	if (rows.length > MAX_ROWS) {
		body += `\n<details><summary>${rows.length - MAX_ROWS} more</summary>\n\n${table(rows.slice(MAX_ROWS))}\n</details>\n`;
	}
}

if (DRY_RUN) {
	console.log(body);
} else {
	const gh = (...args) => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
	const comments = JSON.parse(gh('api', `repos/${GH_REPO}/issues/${PR_NUMBER}/comments`, '--paginate', '--slurp')).flat();
	const existing = comments.find(c => c.body?.includes(MARKER));
	if (existing) {
		gh('api', '-X', 'PATCH', `repos/${GH_REPO}/issues/comments/${existing.id}`, '-f', `body=${body}`);
	} else {
		gh('api', '-X', 'POST', `repos/${GH_REPO}/issues/${PR_NUMBER}/comments`, '-f', `body=${body}`);
	}
}
