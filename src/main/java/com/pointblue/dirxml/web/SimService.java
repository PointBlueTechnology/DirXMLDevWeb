package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.ascode.AsCodeReader;
import com.pointblue.dirxml.dev.deploy.Overrides;
import com.pointblue.dirxml.dev.json.Json;
import com.pointblue.dirxml.dev.model.DriverSet;
import com.pointblue.dirxml.dev.simulate.Simulate;
import com.pointblue.dirxml.dev.source.ExportWriter;
import com.pointblue.dirxml.sim.BatchRunner;
import com.pointblue.dirxml.sim.Case;
import com.pointblue.dirxml.sim.ChannelSimulator;
import com.pointblue.dirxml.sim.Comparer;
import com.pointblue.dirxml.sim.StageSnapshot;
import java.io.IOException;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * The simulator over the tree: the cases of a corpus, the whole corpus run as the gate
 * ({@code idm simulate}), and one case run with every stage's input, output and trace.
 *
 * <p>A case is a directory with {@code case.properties} and {@code input.xds}; the simulator
 * reads a driver's configuration from a single-driver export, so a run writes the case's
 * driver out of the tree (with a stage's overrides applied when one is named) into a scratch
 * directory and runs a copy of the case pointed at it. Cases are only written by {@link #save}
 * and {@link #record}.
 */
public final class SimService {

    /** Keys that name a case's config source; a run replaces them with the tree's driver. */
    private static final Set<String> SOURCE_KEYS = Set.of("export", "project", "ldifConfig", "ldapConfig");
    /** Keys whose values are paths relative to the case directory. */
    private static final Set<String> PATH_KEYS = Set.of("schema", "ldif");
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*");

    private final Path tree;
    private final Path cases;

    public SimService(Path tree, Path cases) {
        this.tree = tree.toAbsolutePath().normalize();
        this.cases = cases.toAbsolutePath().normalize();
    }

    /** Where the corpus is: {@code given}, else {@code cases/} beside the tree (the documented layout), else inside it. */
    public static Path locate(Path tree, Path given) {
        if (given != null) {
            return given;
        }
        Path inside = tree.resolve("cases");
        Path beside = tree.resolveSibling("cases");
        return Files.isDirectory(inside) && !Files.isDirectory(beside) ? inside : beside;
    }

    private Path dir(String name) {
        if (name == null || !NAME.matcher(name).matches()) {
            throw new TreeService.BadRequest("a case name is letters, digits, '.', '_' and '-', with '/' between folders");
        }
        Path d = cases.resolve(name).normalize();
        if (!d.startsWith(cases)) {
            throw new TreeService.BadRequest("outside the cases directory");
        }
        return d;
    }

    private Path existing(String name) {
        Path d = dir(name);
        if (!Files.isRegularFile(d.resolve("input.xds"))) {
            throw new TreeService.NotFound("no case '" + name + "' under " + cases);
        }
        return d;
    }

    private static Properties props(Path caseDir) throws IOException {
        Properties p = new Properties();
        Path f = caseDir.resolve("case.properties");
        if (Files.exists(f)) {
            try (StringReader r = new StringReader(Files.readString(f, StandardCharsets.UTF_8))) {
                p.load(r);
            }
        }
        return p;
    }

    private static String read(Path f) throws IOException {
        return Files.isRegularFile(f) ? Files.readString(f, StandardCharsets.UTF_8) : null;
    }

    /** The corpus: every case with its driver, channel and whether it has something to pass against. */
    public Map<String, Object> list() throws IOException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("dir", cases.toString());
        m.put("exists", Files.isDirectory(cases));
        List<Object> out = new ArrayList<>();
        if (Files.isDirectory(cases)) {
            for (Path d : BatchRunner.discover(cases)) {
                Properties p = props(d);
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("name", cases.relativize(d).toString().replace('\\', '/'));
                c.put("driver", p.getProperty("driver"));
                c.put("channel", p.getProperty("channel", "subscriber").trim().toLowerCase());
                c.put("hasExpected", Files.exists(d.resolve("expected-output.xds")) || Files.exists(d.resolve("expected.assertions")));
                out.add(c);
            }
        }
        m.put("cases", out);
        return m;
    }

    /** One case's own files. */
    public Map<String, Object> files(String name) throws IOException {
        Path d = existing(name);
        Properties p = props(d);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("driver", p.getProperty("driver"));
        m.put("channel", p.getProperty("channel", "subscriber").trim().toLowerCase());
        m.put("properties", read(d.resolve("case.properties")));
        m.put("input", read(d.resolve("input.xds")));
        m.put("expected", read(d.resolve("expected-output.xds")));
        m.put("assertions", read(d.resolve("expected.assertions")));
        m.put("directory", read(d.resolve("directory.xds")));
        return m;
    }

    /** The whole corpus as the gate runs it: each case's verdict against what it recorded. */
    public Map<String, Object> runAll(String env) throws IOException {
        if (!Files.isDirectory(cases)) {
            throw new TreeService.BadRequest("no cases directory at " + cases);
        }
        List<String> notes = new ArrayList<>();
        Simulate.Outcome o = new Simulate(ExportWriter::writeDriver).run(tree, cases, null, blank(env), notes::add);
        Map<String, Object> m = new LinkedHashMap<>(Json.asMap(Json.parse(o.json())));
        m.put("notes", notes);
        m.put("environment", blank(env));
        return m;
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    /**
     * One case, stage by stage. {@code input} replaces the case's input for this run only;
     * {@code env} applies a stage's overrides; {@code againstEnv} runs it a second time under
     * another stage's values ("" = the base values) and says where the two diverge.
     */
    public Map<String, Object> detail(String name, String env, String input, String againstEnv) throws IOException {
        Path d = existing(name);
        Properties p = props(d);
        Path scratch = Files.createTempDirectory("idmweb-sim");
        try {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", name);
            m.put("environment", blank(env));
            List<String> notes = new ArrayList<>();
            Path rendered = render(d, p, name, blank(env), input, scratch.resolve("a"), notes);
            Case c;
            ChannelSimulator.Result r;
            try {
                c = Case.load(rendered);
                r = c.run();
            } catch (RuntimeException e) {
                m.put("ok", false);
                m.put("error", root(e));
                m.put("notes", notes);
                return m;
            }
            m.put("ok", true);
            List<Object> stages = new ArrayList<>();
            for (StageSnapshot s : r.stages) {
                Map<String, Object> st = new LinkedHashMap<>();
                st.put("name", s.stageName);
                st.put("input", s.inputXds);
                st.put("output", s.outputXds);
                st.put("changed", !same(s.inputXds, s.outputXds));
                st.put("trace", s.trace);
                st.put("queries", s.queries);
                st.put("commands", s.commands);
                st.put("error", s.error);
                stages.add(st);
            }
            m.put("stages", stages);
            m.put("final", r.finalXds);
            m.put("trace", r.fullTrace);
            List<String> warnings = new ArrayList<>();
            for (String cn : c.sim.missingJavaClasses()) {
                warnings.add("Java class not on the class path (calls to it fail): " + cn);
            }
            for (String u : c.unresolvedPolicies) {
                warnings.add("linked policy not found: " + u);
            }
            warnings.addAll(c.schemaWarnings);
            m.put("warnings", warnings);
            if (input == null) {
                BatchRunner.CaseResult verdict = BatchRunner.run(scratch.resolve("a"), rendered);
                m.put("outcome", verdict.outcome.name().toLowerCase());
                m.put("outcomeDetail", verdict.detail);
            } else {
                String expected = read(d.resolve("expected-output.xds"));
                if (expected != null) {
                    com.pointblue.dirxml.sim.XmlCompare.Diff diff = com.pointblue.dirxml.sim.XmlCompare.compare(expected, r.finalXds);
                    m.put("outcome", diff.equal ? "pass" : "fail");
                    m.put("outcomeDetail", diff.equal ? "" : diff.message);
                } else {
                    m.put("outcome", "skip");
                    m.put("outcomeDetail", "no expected output recorded");
                }
            }
            if (againstEnv != null) {
                Path other = render(d, p, name, blank(againstEnv), input, scratch.resolve("b"), notes);
                Map<String, Object> cmp = new LinkedHashMap<>();
                cmp.put("environment", blank(againstEnv));
                try {
                    Comparer.Comparison x = Comparer.diff(Case.load(other).run(), r);
                    cmp.put("same", x.finalSame);
                    cmp.put("firstDivergesAt", x.firstDivergesAt);
                    cmp.put("finalDetail", x.finalDetail);
                    List<Object> sd = new ArrayList<>();
                    for (Comparer.StageDiff s : x.stages) {
                        Map<String, Object> one = new LinkedHashMap<>();
                        one.put("name", s.name);
                        one.put("same", s.same);
                        one.put("detail", s.detail);
                        sd.add(one);
                    }
                    cmp.put("stages", sd);
                } catch (RuntimeException e) {
                    cmp.put("error", root(e));
                }
                m.put("against", cmp);
            }
            m.put("notes", notes);
            return m;
        } finally {
            TreeService.deleteTree(scratch);
        }
    }

    private static boolean same(String a, String b) {
        if (a == null || b == null) {
            return a == null && b == null;
        }
        try {
            return com.pointblue.dirxml.sim.XmlCompare.compare(a, b).equal;
        } catch (RuntimeException e) {
            return a.equals(b);
        }
    }

    /** A copy of the case in {@code work} with its config source swapped to the tree's driver. */
    private Path render(Path caseDir, Properties p, String name, String env, String input, Path work, List<String> notes) throws IOException {
        String driver = p.getProperty("driver");
        if (driver == null || driver.isBlank()) {
            throw new TreeService.BadRequest("case '" + name + "' has no driver= in case.properties, so it cannot be run against the tree");
        }
        driver = driver.trim();
        DriverSet ds = AsCodeReader.read(tree);
        if (ds.driver(driver) == null) {
            throw new TreeService.BadRequest("the tree has no driver '" + driver + "' (case '" + name + "')");
        }
        if (env != null) {
            String summary = Overrides.apply(ds, env).summary();
            notes.add(summary == null ? "overrides for '" + env + "': none; base values used" : summary);
        }
        Files.createDirectories(work);
        Path export = work.resolve("driver.xml");
        ExportWriter.writeDriver(ds, driver, export);
        Path target = work.resolve("case");
        Files.createDirectories(target);
        try (Stream<Path> s = Files.list(caseDir)) {
            for (Path f : (Iterable<Path>) s::iterator) {
                String n = f.getFileName().toString();
                if (Files.isRegularFile(f) && !n.equals("case.properties")) {
                    Files.copy(f, target.resolve(n));
                } else if (Files.isDirectory(f) && !Files.exists(f.resolve("input.xds"))) {
                    TreeService.copyTree(f, target.resolve(n));
                }
            }
        }
        if (input != null) {
            Files.writeString(target.resolve("input.xds"), input, StandardCharsets.UTF_8);
        }
        StringBuilder sb = new StringBuilder("# rendered by DirXMLDevWeb: config source swapped to the tree\n");
        List<String> keys = new ArrayList<>(p.stringPropertyNames());
        keys.sort(null);
        for (String k : keys) {
            if (SOURCE_KEYS.contains(k)) {
                continue;
            }
            String v = p.getProperty(k);
            if (PATH_KEYS.contains(k) && v != null && !v.isBlank() && Files.exists(caseDir.resolve(v.trim()))) {
                v = caseDir.resolve(v.trim()).toAbsolutePath().normalize().toString();
            }
            sb.append(k).append('=').append(v == null ? "" : v.replace("\\", "\\\\")).append('\n');
        }
        sb.append("export=").append(export.toAbsolutePath().toString().replace("\\", "\\\\")).append('\n');
        Files.writeString(target.resolve("case.properties"), sb.toString(), StandardCharsets.UTF_8);
        return target;
    }

    /** Create a case, or replace an existing case's input. A new case names its driver and channel. */
    public Map<String, Object> save(String name, String driver, String channel, String input) throws IOException {
        Path d = dir(name);
        if (input == null || input.isBlank()) {
            throw new TreeService.BadRequest("a case needs an input document");
        }
        try {
            javax.xml.parsers.DocumentBuilderFactory f = javax.xml.parsers.DocumentBuilderFactory.newInstance();
            f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            javax.xml.parsers.DocumentBuilder b = f.newDocumentBuilder();
            b.setErrorHandler(null);
            b.parse(new org.xml.sax.InputSource(new StringReader(input)));
        } catch (org.xml.sax.SAXException | javax.xml.parsers.ParserConfigurationException e) {
            throw new TreeService.BadRequest("the input is not well-formed XML: " + e.getMessage());
        }
        boolean created = !Files.exists(d.resolve("case.properties"));
        if (created) {
            if (driver == null || driver.isBlank()) {
                throw new TreeService.BadRequest("a new case names its driver");
            }
            if (AsCodeReader.read(tree).driver(driver) == null) {
                throw new TreeService.BadRequest("the tree has no driver '" + driver + "'");
            }
            String ch = "publisher".equalsIgnoreCase(channel) ? "publisher" : "subscriber";
            Files.createDirectories(d);
            Files.writeString(d.resolve("case.properties"), "driver=" + driver + "\nchannel=" + ch + "\n", StandardCharsets.UTF_8);
        }
        Files.writeString(d.resolve("input.xds"), input, StandardCharsets.UTF_8);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", name);
        m.put("created", created);
        return m;
    }

    /** Run the case against the tree's base values and keep its output as what the case expects from now on. */
    public Map<String, Object> record(String name) throws IOException {
        Path d = existing(name);
        Path scratch = Files.createTempDirectory("idmweb-sim");
        try {
            Path rendered = render(d, props(d), name, null, null, scratch, new ArrayList<>());
            Case c = Case.load(rendered);
            ChannelSimulator.Result r = c.run();
            List<String> wrote = new ArrayList<>();
            Files.writeString(d.resolve("expected-output.xds"), r.finalXds, StandardCharsets.UTF_8);
            wrote.add("expected-output.xds");
            String state = directoryState(c);
            if (state != null) {
                Files.writeString(d.resolve("expected-directory.xds"), state, StandardCharsets.UTF_8);
                wrote.add("expected-directory.xds");
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", name);
            m.put("wrote", wrote);
            return m;
        } catch (RuntimeException e) {
            throw new TreeService.BadRequest("the case did not run, so nothing was recorded: " + root(e));
        } finally {
            TreeService.deleteTree(scratch);
        }
    }

    /**
     * The case's directory after the run, or null when it holds nothing. Read reflectively: the
     * directory's type implements an engine interface, and this build compiles without the
     * engine jars.
     */
    private static String directoryState(Case c) {
        try {
            Object dir = Case.class.getField("directory").get(c);
            int size = (Integer) dir.getClass().getMethod("size").invoke(dir);
            return size > 0 ? (String) dir.getClass().getMethod("dumpState").invoke(dir) : null;
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("cannot read the case's directory state", e);
        }
    }

    private static String root(Throwable t) {
        Throwable c = t;
        while (c.getCause() != null) {
            c = c.getCause();
        }
        return c.getMessage() != null ? c.getMessage() : c.toString();
    }
}
