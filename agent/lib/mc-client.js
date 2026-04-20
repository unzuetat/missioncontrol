/**
 * Cliente minimalista de la API de Mission Control.
 * Usa la MC_API_KEY para autenticarse contra el backend en Vercel.
 */

function slugify(nombre) {
  return nombre
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export class McClient {
  constructor({ baseUrl, apiKey }) {
    if (!baseUrl) throw new Error("McClient: falta MC_API_URL");
    if (!apiKey) throw new Error("McClient: falta MC_API_KEY");
    // Acepta URL sin protocolo y se lo añade (fetch exige URL completa).
    let url = baseUrl.trim().replace(/\/$/, "");
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    this.baseUrl = url;
    this.apiKey = apiKey;
  }

  async _fetch(path, opts = {}) {
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      ...(opts.headers || {}),
    };
    const res = await fetch(this.baseUrl + path, { ...opts, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${opts.method || "GET"} ${path} → ${res.status}: ${text}`);
    }
    return res.json();
  }

  async listarProyectos() {
    const { projects } = await this._fetch("/api/projects");
    return projects || [];
  }

  async crearProyecto(data) {
    const { project } = await this._fetch("/api/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return project;
  }

  async crearCrumb({ projectId, title, source, body, timestamp }) {
    const { crumb } = await this._fetch("/api/crumbs", {
      method: "POST",
      body: JSON.stringify({ projectId, title, source, body, timestamp }),
    });
    return crumb;
  }

  async crearFile({ projectId, name, content }) {
    const { file } = await this._fetch("/api/files", {
      method: "POST",
      body: JSON.stringify({ projectId, name, content }),
    });
    return file;
  }

  async ficherosDeProyecto(projectId) {
    const { files } = await this._fetch(`/api/files?projectId=${projectId}`);
    return files || [];
  }

  async actualizarFile({ fileId, content }) {
    const { file } = await this._fetch("/api/files", {
      method: "PUT",
      body: JSON.stringify({ fileId, content }),
    });
    return file;
  }

  /**
   * Asegura que el proyecto existe (por slug del nombre).
   * Si no existe, lo crea con los metadatos que le pasemos.
   */
  async asegurarProyecto({ nombre, repoUrl, techStack }) {
    const id = slugify(nombre);
    const proyectos = await this.listarProyectos();
    if (proyectos.find((p) => p.id === id)) return id;
    await this.crearProyecto({
      name: nombre,
      status: "desarrollo",
      repoUrl: repoUrl || "",
      techStack: techStack || "",
    });
    return id;
  }
}
