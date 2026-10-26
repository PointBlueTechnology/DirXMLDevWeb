package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.deploy.EnvironmentCompare;
import com.pointblue.dirxml.dev.deploy.Overrides;
import com.pointblue.dirxml.dev.promote.Pair;
import com.pointblue.dirxml.dev.promote.ProjectCompare;
import com.pointblue.dirxml.dev.promote.Projects;
import com.pointblue.dirxml.dev.promote.Promote;
import com.pointblue.dirxml.dev.promote.PromotionRecord;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A project per environment (docs/project-per-environment.md, docs/compare-projects.md): this project compared with
 * another, the differences chosen promoted into a new branch of this one, and the pair itself (its map, first record
 * and known differences) set up the same way. Both sides are read from their base branch as the repository has it
 * ({@code data.dir/promotion/<project>/}, fetched for each request), so what a person reviews is what is applied,
 * whatever their own copies hold. A project's simulator cases come along when both projects have them. The comparison
 * and the writing are the core's ({@link ProjectCompare}, {@link Promote}).
 */
final class PromotionService {

    private final Workspaces workspaces;

    PromotionService(Workspaces workspaces) {
        this.workspaces = workspaces;
    }

    /** A project's base branch as its repository has it now: the tree, its cases (or null) and the commit. */
    record Side(Project project, Path root, Path tree, Path cases, String commit, String note) {
    }

    /** The other projects this one can be compared with. */
    Map<String, Object> projects(Project current) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("project", current.name);
        m.put("base", current.base);
        m.put("inPlace", current.inPlace != null);
        List<Object> others = new ArrayList<>();
        for (Map<String, Object> p : workspaces.projects()) {
            if (!current.name.equals(p.get("name"))) {
                Map<String, Object> o = new LinkedHashMap<>();
                o.put("name", p.get("name"));
                o.put("base", p.get("base"));
                others.add(o);
            }
        }
        m.put("projects", others);
        return m;
    }

    /** {@code p}'s base branch, fetched: a clone of the server's own, reset to what the repository holds. */
    synchronized Side side(Project p) throws IOException {
        Git git = workspaces.gitFor(p);
        if (p.inPlace != null) {
            String branch = git.run(p.inPlace, "rev-parse", "--abbrev-ref", "HEAD").out.trim();
            String commit = git.run(p.inPlace, "rev-parse", "HEAD").out.trim();
            return new Side(p, p.inPlace, p.inPlace.resolve(p.tree).normalize(), cases(p.inPlace, p), commit.isEmpty() ? null : commit,
                "'" + p.name + "' is a checkout in place: read as it is checked out (" + (branch.isEmpty() ? "no branch" : branch) + "), uncommitted work included");
        }
        Path dir = workspaces.config().dataDir.resolve("promotion").resolve(p.name);
        if (!Files.isDirectory(dir.resolve(".git"))) {
            Files.createDirectories(dir.getParent());
            Git.must(git.run(null, "clone", "--branch", p.base, "--single-branch", p.url, dir.toString()), "clone " + p.name);
        } else {
            git.fetchBranch(dir, p.base);
            Git.must(git.run(dir, "checkout", "-q", "-B", p.base, "origin/" + p.base), "check out " + p.base);
            Git.must(git.run(dir, "reset", "-q", "--hard", "origin/" + p.base), "reset to origin/" + p.base);
            Git.must(git.run(dir, "clean", "-q", "-fdx"), "clean");
        }
        return new Side(p, dir, dir.resolve(p.tree).normalize(), cases(dir, p), git.run(dir, "rev-parse", "HEAD").out.trim(), null);
    }

    private static Path cases(Path root, Project p) {
        Path c = root.resolve(p.cases).normalize();
        return Files.isDirectory(c) ? c : null;
    }

    Project source(String from, Project target) {
        if (from == null || from.isBlank()) {
            throw new TreeService.BadRequest("which project to compare with? (from)");
        }
        if (from.equals(target.name)) {
            throw new TreeService.BadRequest("a project is compared with another project");
        }
        if (!Pair.validName(from)) {
            throw new TreeService.BadRequest("'" + from + "' can't name a pair's files: letters, digits, '.', '_' and '-'");
        }
        return workspaces.project(from);
    }

    /** Both trees as a comparison takes them: the cases when both have some, and a map not written yet (or null). */
    static Projects projects(Side t, Side s, Map<String, String> map) {
        Projects p = Projects.of(t.tree(), s.tree(), s.project().name);
        if (t.cases() != null && s.cases() != null) {
            p = p.withCases(t.cases(), s.cases());
        }
        return map == null ? p : p.withMap(map);
    }

    /** A map as the page sends it, the map file's text; null for none (the pair's own file). */
    static Map<String, String> map(String text) {
        return text == null ? null : Overrides.parse(text);
    }

    /**
     * GET /api/promote/compare?from=[&amp;map=]: the differences by bucket, each file with both sides' text for the review.
     * With {@code map}, the comparison uses that map instead of the pair's file: a proposal being reviewed.
     */
    Map<String, Object> compare(Project target, String from, String mapText) throws IOException {
        Project src = source(from, target);
        Side t = side(target);
        Side s = side(src);
        Promote.Preview pv = Promote.preview(projects(t, s, map(mapText)));
        ProjectCompare c = pv.compare;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pair", c.pair);
        m.put("target", side(t));
        m.put("source", side(s));
        m.put("paired", c.paired);
        m.put("map", Files.isRegularFile(t.tree().resolve(Pair.DIR).resolve(src.name + Overrides.EXT)));
        m.put("cases", t.cases() != null && s.cases() != null);
        m.put("revision", revision(t, s, c, mapText));
        List<Object> items = new ArrayList<>();
        for (ProjectCompare.Item i : c.items) {
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("path", i.path);
            o.put("kind", i.value ? "value" : "file");
            o.put("driver", i.driver);
            o.put("bucket", i.bucket.key());
            o.put("state", i.state());
            o.put("changedSinceKnown", i.changedSinceKnown);
            if (i.value) {
                o.put("source", i.sourceValue);
                o.put("target", i.targetValue);
            } else {
                String before = text(pv.before.get(i.path));
                String after = text(pv.after.get(i.path));
                boolean binary = (pv.before.get(i.path) != null && before == null) || (pv.after.get(i.path) != null && after == null);
                o.put("binary", binary);
                if (!binary) {
                    o.put("before", before);
                    o.put("after", after);
                }
                o.put("language", i.path.endsWith(".js") ? "javascript" : i.path.endsWith(".xml") ? "xml" : "plaintext");
            }
            items.add(o);
        }
        m.put("items", items);
        List<Object> matches = new ArrayList<>();
        for (EnvironmentCompare.Match x : c.matches) {
            matches.add(Map.of("source", x.a, "target", x.b, "common", x.common, "of", x.of));
        }
        m.put("matches", matches);
        List<Object> notes = new ArrayList<>(c.notes);
        for (Side x : List.of(t, s)) {
            if (x.note() != null) {
                notes.add(x.note());
            }
        }
        m.put("notes", notes);
        return m;
    }

    /** GET /api/promote/compare?from=&amp;brief=true: the differences without both sides' texts, each file's changed lines instead (for agents). */
    Map<String, Object> brief(Project target, String from) throws IOException {
        Project src = source(from, target);
        Side t = side(target);
        Side s = side(src);
        ProjectCompare c = ProjectCompare.of(projects(t, s, null));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pair", c.pair);
        m.put("target", side(t));
        m.put("source", side(s));
        m.put("paired", c.paired);
        m.put("revision", revision(t, s, c, null));
        List<Object> items = new ArrayList<>();
        for (ProjectCompare.Item i : c.items) {
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("path", i.path);
            o.put("kind", i.value ? "value" : "file");
            o.put("driver", i.driver);
            o.put("bucket", i.bucket.key());
            o.put("state", i.state());
            if (i.value) {
                o.put("source", i.sourceValue);
                o.put("target", i.targetValue);
            } else {
                o.put("detail", i.detail);
            }
            items.add(o);
        }
        m.put("items", items);
        m.put("notes", new ArrayList<Object>(c.notes));
        return m;
    }

    /** GET /api/promote/map?from=: the pair's map file (or none) and a proposal to start from. */
    Map<String, Object> proposedMap(Project target, String from) throws IOException {
        Project src = source(from, target);
        Side t = side(target);
        Side s = side(src);
        Path file = t.tree().resolve(Pair.DIR).resolve(src.name + Overrides.EXT);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("file", Pair.DIR + "/" + src.name + Overrides.EXT);
        m.put("current", Files.isRegularFile(file) ? Files.readString(file, StandardCharsets.UTF_8) : null);
        m.put("proposed", Pair.formatMap(ProjectCompare.proposedMap(projects(t, s, null))));
        return m;
    }

    private static Map<String, Object> side(Side s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("project", s.project().name);
        m.put("base", s.project().base);
        m.put("commit", s.commit());
        return m;
    }

    /** Both commits, the map reviewed, and every difference: a review applies only to what it showed. */
    static String revision(Side t, Side s, ProjectCompare c, String mapText) {
        StringBuilder sb = new StringBuilder(t.commit() + "\n" + s.commit() + "\n" + (mapText == null ? "" : mapText) + "\n");
        for (ProjectCompare.Item i : c.items) {
            sb.append(i.path).append(' ').append(i.fingerprint).append(' ').append(i.bucket).append('\n');
        }
        return PromotionRecord.fingerprint(sb.toString());
    }

    /** The text of a file, or null when it has none (or isn't UTF-8 text: an icon). */
    static String text(byte[] b) {
        if (b == null) {
            return null;
        }
        try {
            String s = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(b)).toString();
            return s.indexOf('\u0000') >= 0 ? null : s;
        } catch (CharacterCodingException e) {
            return null;
        }
    }

    /** What a person chose in a review: files and values to promote, merged texts, and decisions on differences. */
    static final class Choices {
        final List<String> objects = new ArrayList<>();
        final List<String> values = new ArrayList<>();
        final Map<String, String> contents = new LinkedHashMap<>();
        /** Accepted as known: path to {@code {decision, note}}. */
        final Map<String, String[]> known = new LinkedHashMap<>();
        /** Known differences no longer accepted. */
        final List<String> forget = new ArrayList<>();
        /** Check the choice on the base and stop: no branch. */
        boolean dryRun;

        boolean promotes() {
            return !objects.isEmpty() || !values.isEmpty() || !contents.isEmpty();
        }
    }

    /**
     * POST /api/promote/apply: the chosen files and values of {@code from}, and the decisions on known differences, into a
     * new branch of this project made from its base ({@code promote/<from>-<time>}), committed with the promotion record
     * and the {@code Promoted-from} trailer, and pushed. The person's session moves to that branch, where the bar offers
     * the pull request.
     */
    Map<String, Object> apply(Session session, Session.Store sessions, Project target, String from, String revision, Choices ch) throws IOException {
        mayBranch(target);
        Project src = source(from, target);
        if (!ch.promotes() && ch.known.isEmpty() && ch.forget.isEmpty()) {
            throw new TreeService.BadRequest("nothing chosen: tick files or values, or accept differences as known");
        }
        Side t = side(target);
        Side s = side(src);
        Projects onBase = projects(t, s, null);
        stale(t, s, ProjectCompare.of(onBase), null, revision, target, src);
        Promote.Selection sel = selection(ch);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pair", src.name);
        m.put("sourceCommit", s.commit());
        // planned on the base as the repository has it: what was reviewed, and refused before any branch is made
        if (ch.promotes()) {
            Promote.Result plan = Promote.run(onBase, sel, true, false, session.principal.name);
            if (!plan.ok()) {
                return refused(m, plan);
            }
            if (ch.dryRun) {
                m.put("promoted", plan.promoted);
                m.put("values", plan.values);
                m.put("changedFiles", plan.changedFiles);
                m.put("deletedFiles", plan.deletedFiles);
                m.put("notes", plan.notes);
            }
        }
        if (!ch.known.isEmpty()) {
            Promote.Result plan = Promote.accept(onBase, ch.known, session.principal.name, true);
            if (!plan.ok()) {
                return refused(m, plan);
            }
        }
        for (String f : ch.forget) {
            Promote.Result plan = Promote.forget(onBase.target(), src.name, f, true);
            if (!plan.ok()) {
                return refused(m, plan);
            }
        }
        if (ch.dryRun) {
            m.put("ok", true);
            m.put("dryRun", true);
            m.put("branch", null);
            return m;
        }
        Workspace w = newBranch(session, target, "promote/" + src.name, t);
        Projects onBranch = projects(new Side(target, w.root, w.tree, t.cases() == null ? null : w.root.resolve(target.cases).normalize(), t.commit(), null), s, null);
        List<String> promoted = new ArrayList<>();
        List<String> values = new ArrayList<>();
        String trailer = "Promoted-from: " + src.name + "@" + s.commit();
        if (ch.promotes()) {
            Promote.Result r = Promote.run(onBranch, sel, false, false, session.principal.name);
            if (!r.ok()) {
                return refused(m, r);
            }
            promoted.addAll(r.promoted);
            values.addAll(r.values);
            trailer = r.trailer;
            m.put("changedFiles", r.changedFiles);
            m.put("deletedFiles", r.deletedFiles);
        }
        if (!ch.known.isEmpty()) {
            Promote.Result r = Promote.accept(onBranch, ch.known, session.principal.name, false);
            if (!r.ok()) {
                return refused(m, r);
            }
        }
        for (String f : ch.forget) {
            Promote.forget(onBranch.target(), src.name, f, false);
        }
        StringBuilder title = new StringBuilder(ch.promotes() ? "Promote from " + src.name + ": " + promoted.size() + " file(s)" : "Known differences with " + src.name);
        if (!values.isEmpty()) {
            title.append(", ").append(values.size()).append(" value(s)");
        }
        if (ch.promotes() && (!ch.known.isEmpty() || !ch.forget.isEmpty())) {
            title.append("; known differences");
        }
        StringBuilder body = new StringBuilder();
        for (String p : promoted) {
            body.append("- ").append(p).append('\n');
        }
        for (String v : values) {
            body.append("- value ").append(v).append('\n');
        }
        for (Map.Entry<String, String[]> k : ch.known.entrySet()) {
            body.append("- known (").append(k.getValue().length > 0 && k.getValue()[0] != null ? k.getValue()[0] : "intended").append("): ").append(k.getKey()).append('\n');
        }
        for (String f : ch.forget) {
            body.append("- no longer known: ").append(f).append('\n');
        }
        m.put("promoted", promoted);
        m.put("values", values);
        m.put("known", new ArrayList<>(ch.known.keySet()));
        m.put("forget", ch.forget);
        return commit(session, sessions, target, w, title.toString(), body.toString(), trailer, m);
    }

    /**
     * POST /api/promote/pair: the pair's first record, with the map the person reviewed written beside it, the differences
     * they left pending and the ones they accepted as known, into a new branch {@code promote/<from>-pair-<time>},
     * committed and pushed like a promotion.
     */
    Map<String, Object> pair(Session session, Session.Store sessions, Project target, String from, String revision, String mapText,
                             List<String> pending, Map<String, String[]> known) throws IOException {
        mayBranch(target);
        Project src = source(from, target);
        Side t = side(target);
        Side s = side(src);
        Map<String, String> map = map(mapText);
        Projects onBase = projects(t, s, map);
        stale(t, s, ProjectCompare.of(onBase), mapText, revision, target, src);
        Promote.Pairing choices = new Promote.Pairing();
        choices.mapText = mapText;
        choices.pending.addAll(pending);
        choices.known.putAll(known);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pair", src.name);
        m.put("sourceCommit", s.commit());
        Promote.Result plan = Promote.pair(onBase, choices, true, false, session.principal.name);
        if (!plan.ok()) {
            return refused(m, plan);
        }
        Workspace w = newBranch(session, target, "promote/" + src.name + "-pair", t);
        Projects onBranch = projects(new Side(target, w.root, w.tree, t.cases() == null ? null : w.root.resolve(target.cases).normalize(), t.commit(), null), s, map);
        Promote.Result r = Promote.pair(onBranch, choices, false, false, session.principal.name);
        if (!r.ok()) {
            return refused(m, r);
        }
        m.put("notes", r.notes);
        m.put("pending", new ArrayList<>(pending));
        m.put("known", new ArrayList<>(known.keySet()));
        String body = r.notes.isEmpty() ? "" : String.join("\n", r.notes) + "\n";
        return commit(session, sessions, target, w, "Pair with " + src.name, body, "Promoted-from: " + src.name + "@" + s.commit(), m);
    }

    private static void mayBranch(Project target) {
        if (target.inPlace != null) {
            throw new TreeService.BadRequest("'" + target.name + "' is a checkout in place: promoting and pairing need a repository to branch from"
                + " (bin/idm promote.apply and promote.pair do it in a checkout)");
        }
    }

    private static void stale(Side t, Side s, ProjectCompare now, String mapText, String revision, Project target, Project src) {
        if (revision == null || !revision.equals(revision(t, s, now, mapText))) {
            throw new TreeService.Stale(target.base + " of '" + target.name + "' or of '" + src.name + "' changed since this was compared: compare again");
        }
    }

    private static Promote.Selection selection(Choices ch) {
        Promote.Selection sel = new Promote.Selection();
        sel.objects.addAll(ch.objects);
        sel.values.addAll(ch.values);
        sel.contents.putAll(ch.contents);
        return sel;
    }

    /** A new branch of the target from its base, checked to be what was compared. */
    private Workspace newBranch(Session session, Project target, String prefix, Side t) throws IOException {
        String branch = prefix + "-" + ZonedDateTime.now(ZoneOffset.UTC).format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));
        Workspace w = workspaces.openBranch(session.principal, target.name, branch);
        String head = workspaces.gitFor(target).run(w.root, "rev-parse", "HEAD").out.trim();
        if (!head.equals(t.commit())) {
            throw new TreeService.Stale(target.base + " of '" + target.name + "' moved while the branch was made: compare again");
        }
        return w;
    }

    /** Commit everything on the branch as the person, with the trailer, push it, and move their session there. */
    private Map<String, Object> commit(Session session, Session.Store sessions, Project target, Workspace w, String title, String body, String trailer,
                                       Map<String, Object> m) throws IOException {
        String message = title + "\n\n" + (body.isEmpty() ? "" : body + "\n") + trailer + "\n";
        Map<String, Object> c = workspaces.gitFor(target).commit(w.root, message, session.principal.name, session.principal.email, true);
        sessions.opened(session, w.id, target.name, w.branch);
        m.put("ok", true);
        m.put("branch", w.branch);
        m.put("hash", c.get("hash"));
        m.put("pushed", c.get("pushed"));
        m.put("trailer", trailer);
        m.put("title", title);
        return m;
    }

    private static Map<String, Object> refused(Map<String, Object> m, Promote.Result r) {
        m.put("ok", false);
        m.put("refusal", r.refusal);
        List<Object> errors = new ArrayList<>();
        for (com.pointblue.dirxml.dev.validate.Finding f : r.newErrors) {
            errors.add(Map.of("code", f.code, "path", f.path, "message", f.message));
        }
        m.put("newErrors", errors);
        m.put("notes", r.notes);
        return m;
    }
}
