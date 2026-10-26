package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.deploy.EnvironmentCompare;
import com.pointblue.dirxml.dev.promote.Pair;
import com.pointblue.dirxml.dev.promote.ProjectCompare;
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
 * A project per environment (docs/project-per-environment.md, R2): this project compared with another, and the
 * differences chosen promoted into a new branch of this one. Both sides are read from their base branch as the
 * repository has it ({@code data.dir/promotion/<project>/}, fetched for each request), so what a person reviews is
 * what a promotion applies, whatever their own copies hold. The comparison and the promotion are the core's
 * ({@link ProjectCompare}, {@link Promote}).
 */
final class PromotionService {

    private final Workspaces workspaces;

    PromotionService(Workspaces workspaces) {
        this.workspaces = workspaces;
    }

    /** A project's base branch as its repository has it now: the tree and the commit. */
    record Side(Project project, Path root, Path tree, String commit, String note) {
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
            return new Side(p, p.inPlace, p.inPlace.resolve(p.tree).normalize(), commit.isEmpty() ? null : commit,
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
        return new Side(p, dir, dir.resolve(p.tree).normalize(), git.run(dir, "rev-parse", "HEAD").out.trim(), null);
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

    /** GET /api/promote/compare?from=: the differences by bucket, each file with both sides' text for the review. */
    Map<String, Object> compare(Project target, String from) throws IOException {
        Project src = source(from, target);
        Side t = side(target);
        Side s = side(src);
        Promote.Preview pv = Promote.preview(t.tree(), s.tree(), src.name);
        ProjectCompare c = pv.compare;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pair", c.pair);
        m.put("target", side(t));
        m.put("source", side(s));
        m.put("paired", c.paired);
        m.put("map", Files.isRegularFile(t.tree().resolve(Pair.DIR).resolve(src.name + ".properties")));
        m.put("revision", revision(t, s, c));
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

    private static Map<String, Object> side(Side s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("project", s.project().name);
        m.put("base", s.project().base);
        m.put("commit", s.commit());
        return m;
    }

    /** Both commits and every difference: a review applies only to what it showed. */
    static String revision(Side t, Side s, ProjectCompare c) {
        StringBuilder sb = new StringBuilder(t.commit() + "\n" + s.commit() + "\n");
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

    /**
     * POST /api/promote/apply: the chosen files and values of {@code from}, into a new branch of this project made from
     * its base ({@code promote/<from>-<time>}), committed with the promotion record and the {@code Promoted-from}
     * trailer, and pushed. The person's session moves to that branch, where the bar offers the pull request.
     */
    Map<String, Object> apply(Session session, Session.Store sessions, Project target, String from, String revision, List<String> objects,
                              List<String> values, Map<String, String> contents) throws IOException {
        if (target.inPlace != null) {
            throw new TreeService.BadRequest("'" + target.name + "' is a checkout in place: a promotion needs a repository to branch from"
                + " (bin/idm promote.apply does it in a checkout)");
        }
        Project src = source(from, target);
        Side t = side(target);
        Side s = side(src);
        Promote.Selection sel = new Promote.Selection();
        sel.objects.addAll(objects);
        sel.values.addAll(values);
        sel.contents.putAll(contents);
        // the plan, on the base as the repository has it: what was reviewed, and refused before any branch is made
        Pair pair = Pair.read(t.tree(), src.name);
        ProjectCompare now = ProjectCompare.of(t.tree(), s.tree(), pair.name);
        if (revision == null || !revision.equals(revision(t, s, now))) {
            throw new TreeService.Stale(target.base + " of '" + target.name + "' or of '" + src.name + "' changed since this was compared: compare again");
        }
        Promote.Result plan = Promote.run(t.tree(), s.tree(), pair.name, sel, true, false, session.principal.name);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pair", pair.name);
        m.put("sourceCommit", s.commit());
        m.put("promoted", plan.promoted);
        m.put("values", plan.values);
        m.put("notes", plan.notes);
        if (!plan.ok()) {
            m.put("ok", false);
            m.put("refusal", plan.refusal);
            m.put("newErrors", errors(plan));
            return m;
        }
        String branch = "promote/" + src.name + "-" + ZonedDateTime.now(ZoneOffset.UTC).format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));
        Workspace w = workspaces.openBranch(session.principal, target.name, branch);
        Git git = workspaces.gitFor(target);
        String head = git.run(w.root, "rev-parse", "HEAD").out.trim();
        if (!head.equals(t.commit())) {
            throw new TreeService.Stale(target.base + " of '" + target.name + "' moved while the branch was made: compare again");
        }
        Promote.Result r = Promote.run(w.tree, s.tree(), pair.name, sel, false, false, session.principal.name);
        if (!r.ok()) {
            m.put("ok", false);
            m.put("refusal", r.refusal);
            m.put("newErrors", errors(r));
            return m;
        }
        StringBuilder msg = new StringBuilder("Promote from " + src.name + ": ");
        msg.append(r.promoted.size()).append(" file(s)");
        if (!r.values.isEmpty()) {
            msg.append(", ").append(r.values.size()).append(" value(s)");
        }
        msg.append("\n\n");
        for (String p : r.promoted) {
            msg.append("- ").append(p).append('\n');
        }
        for (String v : r.values) {
            msg.append("- value ").append(v).append('\n');
        }
        msg.append('\n').append(r.trailer).append('\n');
        Map<String, Object> c = git.commit(w.root, msg.toString(), session.principal.name, session.principal.email, true);
        sessions.opened(session, w.id, target.name, branch);
        m.put("ok", true);
        m.put("branch", branch);
        m.put("hash", c.get("hash"));
        m.put("pushed", c.get("pushed"));
        m.put("changedFiles", r.changedFiles);
        m.put("deletedFiles", r.deletedFiles);
        m.put("trailer", r.trailer);
        m.put("title", "Promote from " + src.name + ": " + r.promoted.size() + " file(s)" + (r.values.isEmpty() ? "" : ", " + r.values.size() + " value(s)"));
        return m;
    }

    private static List<Object> errors(Promote.Result r) {
        List<Object> out = new ArrayList<>();
        for (com.pointblue.dirxml.dev.validate.Finding f : r.newErrors) {
            out.add(Map.of("code", f.code, "path", f.path, "message", f.message));
        }
        return out;
    }
}
