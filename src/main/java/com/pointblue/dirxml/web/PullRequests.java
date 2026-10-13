package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.json.Json;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.net.ssl.SSLContext;

/**
 * Pull requests through the provider's API (#35, docs/pull-requests.md): GitHub (github.com and Enterprise) and
 * GitLab (gitlab.com and self-managed). Finds the branch's open request and creates one. The provider and its API
 * address come from the remote, or from the project's {@code repo.provider} / {@code repo.apiUrl}.
 */
final class PullRequests {

    enum Provider {
        GITHUB("GitHub"), GITLAB("GitLab");

        final String label;

        Provider(String label) {
            this.label = label;
        }
    }

    /** Where the requests go: the provider, its API, the repository's path on it ({@code owner/repo}, {@code group/sub/project}). */
    record Target(Provider provider, String apiUrl, String repoPath) {
    }

    /** The provider said no: its own message, and the HTTP status. */
    static final class ProviderError extends RuntimeException {
        final int status;

        ProviderError(String message, int status) {
            super(message);
            this.status = status;
        }
    }

    private final HttpClient http;

    PullRequests(SSLContext tls) {
        HttpClient.Builder b = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL);
        if (tls != null) {
            b.sslContext(tls);
        }
        this.http = b.build();
    }

    /**
     * The target for a remote, or null when the provider is not one we speak. {@code provider} and {@code apiUrl}
     * override what the remote says (a self-hosted GitHub Enterprise or a GitLab without "gitlab" in its name).
     */
    static Target target(String remote, String provider, String apiUrl) {
        if (remote == null || remote.isBlank()) {
            return null;
        }
        String r = remote.trim().replaceAll("://[^@/]+@", "://").replaceAll("/+$", "").replaceAll("\\.git$", "");
        String host;
        String path;
        if (r.matches("[^/@:]+@[^:/]+:.+")) {             // git@host:owner/repo
            host = r.substring(r.indexOf('@') + 1, r.indexOf(':'));
            path = r.substring(r.indexOf(':') + 1);
        } else if (r.matches("[a-z+]+://.+")) {             // https://host/owner/repo, ssh://git@host:22/owner/repo
            String rest = r.substring(r.indexOf("://") + 3);
            rest = rest.contains("@") ? rest.substring(rest.indexOf('@') + 1) : rest;
            int slash = rest.indexOf('/');
            if (slash < 0) {
                return null;
            }
            host = rest.substring(0, slash);
            path = rest.substring(slash + 1);
        } else {
            return null;
        }
        String hostOnly = host.replaceAll(":\\d+$", "").toLowerCase(Locale.ROOT);
        Provider p = null;
        if (provider != null && !provider.isBlank()) {
            String v = provider.trim().toLowerCase(Locale.ROOT);
            p = v.equals("github") ? Provider.GITHUB : v.equals("gitlab") ? Provider.GITLAB : null;
            if (p == null) {
                throw new IllegalArgumentException("repo.provider is github or gitlab, not '" + provider + "'");
            }
        } else if (hostOnly.equals("github.com")) {
            p = Provider.GITHUB;
        } else if (hostOnly.contains("gitlab")) {
            p = Provider.GITLAB;
        }
        if (p == null || path.isBlank()) {
            return null;
        }
        String api = apiUrl != null && !apiUrl.isBlank() ? apiUrl.trim().replaceAll("/+$", "")
            : p == Provider.GITHUB ? (hostOnly.equals("github.com") ? "https://api.github.com" : "https://" + hostOnly + "/api/v3")
            : "https://" + hostOnly + "/api/v4";
        return new Target(p, api, path);
    }

    /** The branch's open request, or null. */
    Map<String, Object> findOpen(Target t, String token, String branch) throws IOException {
        Object o;
        if (t.provider() == Provider.GITHUB) {
            String owner = t.repoPath().substring(0, t.repoPath().indexOf('/') < 0 ? t.repoPath().length() : t.repoPath().indexOf('/'));
            o = call(t, token, "GET", "/repos/" + t.repoPath() + "/pulls?state=open&head=" + enc(owner + ":" + branch), null);
        } else {
            o = call(t, token, "GET", "/projects/" + enc(t.repoPath()) + "/merge_requests?state=opened&source_branch=" + enc(branch), null);
        }
        List<Object> list = Json.asList(o);
        return list == null || list.isEmpty() ? null : request(t, Json.asMap(list.get(0)));
    }

    /** Creates the request; returns it as {@link #request} gives it. */
    Map<String, Object> create(Target t, String token, String base, String branch, String title, String body, boolean draft) throws IOException {
        Map<String, Object> req = new LinkedHashMap<>();
        Object o;
        if (t.provider() == Provider.GITHUB) {
            req.put("title", title);
            req.put("head", branch);
            req.put("base", base);
            req.put("body", body);
            req.put("draft", draft);
            o = call(t, token, "POST", "/repos/" + t.repoPath() + "/pulls", req);
        } else {
            req.put("source_branch", branch);
            req.put("target_branch", base);
            req.put("title", draft && !title.startsWith("Draft:") ? "Draft: " + title : title);
            req.put("description", body);
            o = call(t, token, "POST", "/projects/" + enc(t.repoPath()) + "/merge_requests", req);
        }
        return request(t, Json.asMap(o));
    }

    /** One request, the same shape for both providers: number, url, state, title, draft. */
    static Map<String, Object> request(Target t, Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        boolean gh = t.provider() == Provider.GITHUB;
        m.put("provider", t.provider().label);
        m.put("number", gh ? r.get("number") : r.get("iid"));
        m.put("url", Json.asString(gh ? r.get("html_url") : r.get("web_url")));
        m.put("state", Json.asString(r.get("state")));
        m.put("title", Json.asString(r.get("title")));
        m.put("draft", Boolean.TRUE.equals(r.get("draft")) || Boolean.TRUE.equals(r.get("work_in_progress")));
        return m;
    }

    private Object call(Target t, String token, String method, String path, Object body) throws IOException {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(t.apiUrl() + path)).timeout(Duration.ofSeconds(30))
            .header("Accept", t.provider() == Provider.GITHUB ? "application/vnd.github+json" : "application/json")
            .header("User-Agent", "DirXMLDevWeb");
        if (t.provider() == Provider.GITHUB) {
            b.header("X-GitHub-Api-Version", "2022-11-28");
            if (token != null) {
                b.header("Authorization", "Bearer " + token);
            }
        } else if (token != null) {
            b.header("PRIVATE-TOKEN", token);
        }
        if (body == null) {
            b.method(method, HttpRequest.BodyPublishers.noBody());
        } else {
            b.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(Json.compact(body), StandardCharsets.UTF_8));
        }
        HttpResponse<String> res;
        try {
            res = http.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("interrupted calling " + t.provider().label);
        }
        Object parsed = null;
        try {
            parsed = res.body() == null || res.body().isBlank() ? null : Json.parse(res.body());
        } catch (RuntimeException e) {
            // not JSON: the status says it
        }
        if (res.statusCode() / 100 != 2) {
            throw new ProviderError(t.provider().label + " (" + res.statusCode() + "): " + message(parsed, res.statusCode()), res.statusCode());
        }
        return parsed;
    }

    /** The provider's own words: GitHub's message and errors[].message, GitLab's message (a string, a list or a map). */
    static String message(Object parsed, int status) {
        if (!(parsed instanceof Map)) {
            return "HTTP " + status;
        }
        Map<String, Object> m = Json.asMap(parsed);
        StringBuilder sb = new StringBuilder();
        Object msg = m.get("message");
        if (msg instanceof String) {
            sb.append(msg);
        } else if (msg instanceof List) {
            for (Object x : Json.asList(msg)) {
                sb.append(sb.length() == 0 ? "" : "; ").append(x);
            }
        } else if (msg instanceof Map) {
            for (Map.Entry<String, Object> e : Json.asMap(msg).entrySet()) {
                sb.append(sb.length() == 0 ? "" : "; ").append(e.getKey()).append(' ').append(e.getValue());
            }
        }
        if (m.get("errors") instanceof List) {
            for (Object e : Json.asList(m.get("errors"))) {
                Object em = e instanceof Map ? Json.asMap(e).get("message") : e;
                if (em != null) {
                    sb.append(sb.length() == 0 ? "" : "; ").append(em);
                }
            }
        }
        if (sb.length() == 0 && m.get("error") != null) {
            sb.append(m.get("error"));
        }
        return sb.length() == 0 ? "HTTP " + status : sb.toString();
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
