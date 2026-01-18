export const Auth = {
	set: token => localStorage.setItem("scratch_token", token),
	get: () => localStorage.getItem("scratch_token"),
	clear: () => localStorage.removeItem("scratch_token"),
};

const request = async (method, path, body = null) => {
	const token = Auth.get();
	if (!token && path !== "/-/verify") {
		throw new Error("No auth token");
	}

	const headers = {
		Authorization: `Bearer ${token}`,
	};

	if (body) {
		headers["Content-Type"] = "application/json";
	}

	try {
		const resp = await fetch(path, {
			method: method,
			headers: headers,
			body: body ? JSON.stringify(body) : null,
		});

		if (resp.status === 403) {
			window.dispatchEvent(new CustomEvent("auth:expired"));
			throw new Error("Unauthorized");
		}

		if (!resp.ok) {
			let errMsg = resp.statusText;
			try {
				const json = await resp.json();
				if (json.error) {
					errMsg = json.error;
				}
			} catch {}
			throw new Error(errMsg);
		}

		// Handle 204 or empty bodies
		const text = await resp.text();
		return text ? JSON.parse(text) : {};
	} catch (e) {
		console.error(`API Error [${path}]:`, e);
		throw e;
	}
};

export const API = {
	verify: () => request("GET", "/-/verify"),
	list: () => request("GET", "/-/list"),
	create: data => request("POST", "/-/note", data),
	update: (id, data) => request("PUT", `/-/note/${id}`, data),
};
