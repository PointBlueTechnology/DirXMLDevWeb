package com.pointblue.dirxml.web;

import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * {@code idmweb setup}: the local install, one person and one container, written from inside the
 * image so the host needs only Docker (docs/simple-install.md). On {@code /idmweb} (the host's
 * folder, mounted) it writes what {@code setup.sh} writes from a checkout: {@code compose.yml} and
 * {@code .env}, {@code config/hosted.properties}, the tokens in {@code idmweb.env}, the
 * environments split into definitions and your own credentials, and {@code repo.git} seeded with
 * a tree when one is mounted. Re-running keeps the repository, the tokens and the configuration,
 * and takes a new image and port. It does not start anything: {@code docker compose up} does, so
 * the container never needs the Docker socket.
 */
public final class LocalSetup {

    /** The single-user files, copied into the jar from hosted/docker/single-user (one source for setup.sh and setup). */
    static final String TEMPLATES = "/com/pointblue/dirxml/web/setup/";
    static final String DEFAULT_IMAGE_REPO = "ghcr.io/pointbluetechnology/dirxml-dev-web";

    /** A line that is a credential, not a definition: bind DN, trust, any password form (as setup.sh splits them). */
    static final Pattern CRED = Pattern.compile(
        "^\\s*[^.=:\\s#!]+\\.(bindDn|trustAll|[A-Za-z0-9_]*[pP]assword(Env|Command|Keychain)?)\\s*[=:].*");
    private static final Pattern KEY = Pattern.compile("^\\s*([^=:\\s]+)");
    private static final Pattern SECRETS_REF = Pattern.compile("^\\s*[^.=:\\s]+\\.secrets\\s*[=:]\\s*([^/\\s]\\S*)\\s*$");

    /** What {@code setup} was asked for. */
    static final class Options {
        Path dir = Path.of("/idmweb");
        Path tree;
        Path cases;
        Path environments;
        int port = 8080;
        String image;
        String user = "me";
        String project = "idm";
        boolean podman;
    }

    /** Thrown for a request setup cannot carry out; its message is what the person reads. */
    static final class Refused extends Exception {
        Refused(String message) {
            super(message);
        }
    }

    private LocalSetup() {
    }

    static final String USAGE = "usage: idmweb setup [--tree DIR] [--cases DIR] [--port N] [--image NAME] [--user NAME]\n"
        + "                    [--project NAME] [--environments FILE] [--podman] [--dir DIR]\n"
        + "  run in the image, with your folder mounted at /idmweb:\n"
        + "    docker run --rm --pull always -v \"$HOME/idmweb:/idmweb\" " + DEFAULT_IMAGE_REPO + ":latest setup\n"
        + "  a tree, mounted read-only:  -v /path/to/tree:/tree:ro  …  setup --tree /tree";

    /** The command: 0 done, 1 refused, 2 usage. */
    public static int main(String[] args, PrintStream out, PrintStream err) {
        Options o;
        try {
            o = parse(args);
        } catch (IllegalArgumentException e) {
            err.println(e.getMessage());
            err.println(USAGE);
            return 2;
        }
        try {
            run(o, out);
            return 0;
        } catch (Refused e) {
            err.println("ERROR: " + e.getMessage());
            return 1;
        } catch (IOException | InterruptedException e) {
            err.println("ERROR: " + e.getMessage());
            return 1;
        }
    }

    static Options parse(String[] args) {
        Options o = new Options();
        for (int i = 0; i < args.length; i++) {
            String a = args[i];
            if (a.equals("--podman")) {
                o.podman = true;
                continue;
            }
            if (a.equals("-h") || a.equals("--help")) {
                throw new IllegalArgumentException("");
            }
            if (i + 1 >= args.length) {
                throw new IllegalArgumentException(a + " needs a value");
            }
            String v = args[++i];
            switch (a) {
                case "--dir" -> o.dir = Path.of(v);
                case "--tree" -> o.tree = Path.of(v);
                case "--cases" -> o.cases = Path.of(v);
                case "--environments" -> o.environments = Path.of(v);
                case "--port" -> {
                    try {
                        o.port = Integer.parseInt(v);
                    } catch (NumberFormatException e) {
                        throw new IllegalArgumentException("--port must be a number");
                    }
                    if (o.port < 1 || o.port > 65535) {
                        throw new IllegalArgumentException("--port must be 1–65535");
                    }
                }
                case "--image" -> o.image = v;
                case "--user" -> o.user = v;
                case "--project" -> o.project = v;
                default -> throw new IllegalArgumentException("unexpected argument '" + a + "'");
            }
        }
        if (!o.user.matches("[A-Za-z0-9._@-]+")) {
            throw new IllegalArgumentException("--user: letters, digits, '.', '_', '@' and '-' only");
        }
        if (!o.project.matches("[A-Za-z0-9._-]+")) {
            throw new IllegalArgumentException("--project: letters, digits, '.', '_' and '-' only");
        }
        return o;
    }

    /** The image the compose file runs: --image, else this release's own. */
    static String image(Options o) {
        return o.image != null && !o.image.isBlank() ? o.image : DEFAULT_IMAGE_REPO + ":" + Serve.VERSION;
    }

    static void run(Options o, PrintStream out) throws IOException, InterruptedException, Refused {
        Path dir = o.dir;
        if (!Files.isDirectory(dir)) {
            throw new Refused(dir + " is not mounted: run setup with your folder mounted there (-v \"$HOME/idmweb:" + dir + "\")");
        }
        if (!Files.isWritable(dir)) {
            throw new Refused(dir + " is not writable by uid " + uid() + ". On Linux, create the folder and run setup as yourself:\n"
                + "  mkdir -p ~/idmweb && docker run --rm -u \"$(id -u):$(id -g)\" -v \"$HOME/idmweb:" + dir + "\" " + image(o) + " setup\n"
                + "(If Docker already made the folder, it is root's: take it back first with  sudo chown \"$(id -u):$(id -g)\" ~/idmweb)");
        }
        if (o.tree != null && !Files.isRegularFile(o.tree.resolve("driverset.xml"))) {
            throw new Refused(o.tree + " is not an IDM-as-code tree (no driverset.xml); mount one there, or leave --tree out to start without one");
        }
        for (String d : List.of("config", "data", "lib", "repo.git")) {
            Files.createDirectories(dir.resolve(d));
        }
        // the compose files are ours: always the current release's
        copyTemplate("compose.yml", dir.resolve("compose.yml"));
        if (o.podman) {
            copyTemplate("compose.podman.yml", dir.resolve("compose.podman.yml"));
        }
        boolean seeded = false;
        if (o.tree != null && isEmpty(dir.resolve("repo.git"))) {
            seed(o, dir.resolve("repo.git"));
            seeded = true;
            out.println("repository: repo.git, branch main holding tree/ and cases/");
        }
        Path hostedProps = dir.resolve("config/hosted.properties");
        String project = o.tree != null ? o.project : null;
        if (!Files.exists(hostedProps)) {
            Files.writeString(hostedProps, hostedProperties(template("config/hosted.properties"), o.user, o.port, project), StandardCharsets.UTF_8);
        } else {
            // a re-run keeps the configuration; only a localhost public.url follows a new port
            String cur = Files.readString(hostedProps, StandardCharsets.UTF_8);
            String moved = cur.replaceAll("(?m)^public\\.url=http://localhost:\\d+\\s*$", "public.url=http://localhost:" + o.port);
            if (!moved.equals(cur)) {
                Files.writeString(hostedProps, moved, StandardCharsets.UTF_8);
            }
        }
        Path env = dir.resolve("idmweb.env");
        String token = ensureTokens(env);
        Path mine = environments(o, dir, out);
        for (Path p : listProperties(dir.resolve("config"))) {
            owner(p);
        }
        String uid = uid();
        String gid = gid();
        StringBuilder dotEnv = new StringBuilder()
            .append("IDMWEB_IMAGE=").append(image(o)).append('\n')
            .append("IDMWEB_PORT=").append(o.port).append('\n')
            .append("IDMWEB_UID=").append(uid).append('\n')
            .append("IDMWEB_GID=").append(gid).append('\n');
        if (o.podman) {
            dotEnv.append("COMPOSE_FILE=compose.yml:compose.podman.yml\n");
        }
        Files.writeString(dir.resolve(".env"), dotEnv.toString(), StandardCharsets.UTF_8);
        String proj = projectOf(Files.readString(hostedProps, StandardCharsets.UTF_8));
        // the agent kit (docs/agents.md): this version's rules, skills and docs, refreshed by every setup
        Path kit = AgentKit.locate();
        int kitFiles = kit == null ? 0 : AgentKit.write(kit, dir.resolve("agent"), Serve.VERSION, "http://localhost:" + o.port + "/mcp");

        out.println();
        out.println("DirXMLDevWeb is set up in the folder you mounted at " + dir + " (image " + image(o) + ", port " + o.port + ").");
        out.println("Start it:");
        out.println("  docker compose -f <that folder>/compose.yml up -d        e.g. docker compose -f \"$HOME/idmweb/compose.yml\" up -d");
        out.println("Then open this link to sign in (it carries your token; keep it to yourself):");
        out.println("  http://localhost:" + o.port + "/auth/login#signin=" + token);
        out.println("  or sign in with the first token in idmweb.env");
        if (proj != null) {
            out.println("Project '" + proj + "'" + (seeded ? " from your tree" : "") + ": open the branch main on the page.");
        } else {
            out.println("No tree yet: the page asks where it comes from (a vault, a Designer project or export, a repository, a remote).");
        }
        out.println("The CLI:        docker exec idmweb idm validate tree     (also: sim, apps)");
        if (kitFiles > 0) {
            out.println("Agents:         agent/ holds the rules, skills and docs (start Claude Code there, or copy agent/.claude/skills to your own);");
            out.println("                MCP at http://localhost:" + o.port + "/mcp with a token from the page (your name at the top right > Agent tokens...)");
        }
        out.println("Engine jars:    optional (validate's compile check and the simulator): copy them into lib/, then docker restart idmweb");
        out.println("Your vault password goes in " + dir.relativize(mine) + " (the page's Connections view writes it).");
        out.println("Stop:           docker compose -f <that folder>/compose.yml down");
    }

    // ---- the pieces ---------------------------------------------------------------------------

    static String template(String name) throws IOException {
        try (InputStream in = LocalSetup.class.getResourceAsStream(TEMPLATES + name)) {
            if (in == null) {
                throw new IOException("the setup template " + name + " is missing from the jar");
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static void copyTemplate(String name, Path to) throws IOException {
        Files.writeString(to, template(name), StandardCharsets.UTF_8);
    }

    /** The single-user template with the person, the port and the first project (none: its project lines go). */
    static String hostedProperties(String template, String user, int port, String project) {
        StringBuilder sb = new StringBuilder();
        for (String line : template.split("\n", -1)) {
            if (line.startsWith("token.user=")) {
                line = "token.user=" + user;
            } else if (line.startsWith("public.url=")) {
                line = "public.url=http://localhost:" + port;
            } else if (line.contains("PROJECT")) {
                if (project == null) {
                    continue;
                }
                line = line.replace("PROJECT", project);
            }
            sb.append(line).append('\n');
        }
        String s = sb.toString();
        return s.endsWith("\n\n") ? s.substring(0, s.length() - 1) : s;
    }

    static String projectOf(String hostedProperties) {
        for (String line : hostedProperties.split("\n")) {
            if (line.startsWith("projects=")) {
                String v = line.substring("projects=".length()).trim();
                return v.isEmpty() ? null : v.split(",")[0].trim();
            }
        }
        return null;
    }

    /** idmweb.env holds your token and an agent's; existing ones stay. Returns yours. */
    static String ensureTokens(Path env) throws IOException {
        Map<String, String> values = new LinkedHashMap<>();
        if (Files.exists(env)) {
            for (String line : Files.readAllLines(env, StandardCharsets.UTF_8)) {
                int eq = line.indexOf('=');
                if (eq > 0) {
                    values.put(line.substring(0, eq), line.substring(eq + 1));
                }
            }
        }
        StringBuilder add = new StringBuilder();
        for (String k : List.of("IDMWEB_TOKEN", "IDMWEB_AGENT_TOKEN")) {
            if (!values.containsKey(k) || values.get(k).isBlank()) {
                String t = newToken();
                values.put(k, t);
                add.append(k).append('=').append(t).append('\n');
            }
        }
        if (!Files.exists(env)) {
            Files.writeString(env, "", StandardCharsets.UTF_8);
        }
        owner(env);
        if (add.length() > 0) {
            String cur = Files.readString(env, StandardCharsets.UTF_8);
            Files.writeString(env, cur + (cur.isEmpty() || cur.endsWith("\n") ? "" : "\n") + add, StandardCharsets.UTF_8);
        }
        return values.get("IDMWEB_TOKEN");
    }

    /** 40 characters from A–Z, a–z, 0–9 (about 238 bits): always the same length, safe in a URL and a shell. */
    static String newToken() {
        String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        SecureRandom r = new SecureRandom();
        StringBuilder sb = new StringBuilder(40);
        for (int i = 0; i < 40; i++) {
            sb.append(alphabet.charAt(r.nextInt(alphabet.length())));
        }
        return sb.toString();
    }

    /**
     * The environments: definitions in config/environments.properties, your bind DN and passwords
     * in data/users/<you>/environments.properties (the server refuses a password in config/).
     * From --environments when given and there are none yet; an older config/ file with passwords
     * is split too, the original kept as environments.properties.before-split. Returns your file.
     */
    static Path environments(Options o, Path dir, PrintStream out) throws IOException {
        Path config = dir.resolve("config/environments.properties");
        String user = userOf(Files.readString(dir.resolve("config/hosted.properties"), StandardCharsets.UTF_8), o.user);
        Path mineDir = dir.resolve("data/users").resolve(user.replaceAll("[^A-Za-z0-9._-]", "_"));
        Path mine = mineDir.resolve("environments.properties");
        if (!Files.exists(config)) {
            if (o.environments != null && Files.isRegularFile(o.environments)) {
                split(o.environments, config, mine, out);
            } else {
                Files.writeString(config, "", StandardCharsets.UTF_8);
            }
        } else if (Files.readAllLines(config, StandardCharsets.UTF_8).stream().anyMatch(l -> CRED.matcher(l).matches())) {
            Path before = dir.resolve("config/environments.properties.before-split");
            Files.copy(config, before, StandardCopyOption.REPLACE_EXISTING);
            owner(before);
            split(before, config, mine, out);
            out.println("  (the file as it was: config/environments.properties.before-split; delete it once the page connects)");
        }
        return mine;
    }

    static String userOf(String hostedProperties, String fallback) {
        for (String line : hostedProperties.split("\n")) {
            if (line.startsWith("token.user=")) {
                String v = line.substring("token.user=".length()).trim();
                return v.isEmpty() ? fallback : v;
            }
        }
        return fallback;
    }

    /** Definitions to {@code config}, credential lines to {@code mine} (keys already there stay as they are). */
    static void split(Path from, Path config, Path mine, PrintStream out) throws IOException {
        List<String> lines = Files.readAllLines(from, StandardCharsets.UTF_8);
        Files.createDirectories(mine.getParent());
        try {
            Files.setPosixFilePermissions(mine.getParent(), PosixFilePermissions.fromString("rwx------"));
        } catch (UnsupportedOperationException ignored) {
            // not a POSIX file system
        }
        List<String> existing = Files.exists(mine) ? Files.readAllLines(mine, StandardCharsets.UTF_8) : new ArrayList<>();
        List<String> defs = new ArrayList<>();
        List<String> creds = new ArrayList<>(existing);
        int n = 0;
        for (String l : lines) {
            if (!CRED.matcher(l).matches()) {
                defs.add(l);
                continue;
            }
            Matcher k = KEY.matcher(l);
            String key = k.find() ? k.group(1) : "";
            boolean have = existing.stream().map(KEY::matcher).anyMatch(m -> m.find() && m.group(1).equals(key));
            if (!have) {
                creds.add(l);
                n++;
            }
        }
        Files.write(config, defs, StandardCharsets.UTF_8);
        Files.write(mine, creds, StandardCharsets.UTF_8);
        owner(mine);
        owner(config);
        out.println("environments: definitions in config/environments.properties, " + n + " credential line(s) in "
            + config.getParent().getParent().relativize(mine));
        if (creds.stream().anyMatch(l -> l.matches(".*Keychain\\s*[=:].*"))) {
            out.println("  NOTE: Keychain references do not resolve in the container; set those passwords again under Connections");
        }
        if (creds.stream().anyMatch(l -> l.matches(".*Env\\s*[=:].*"))) {
            out.println("  NOTE: …Env references read the container's environment: add each variable to idmweb.env");
        }
        // a relative <env>.secrets file (driver secrets) comes along beside the definitions
        for (String d : defs) {
            Matcher m = SECRETS_REF.matcher(d);
            if (m.matches()) {
                Path src = from.resolveSibling(m.group(1));
                Path dst = config.resolveSibling(m.group(1));
                if (Files.isRegularFile(src) && !Files.exists(dst) && !src.equals(dst)) {
                    Files.copy(src, dst);
                    owner(dst);
                    out.println("  driver secrets: copied " + m.group(1));
                }
            }
        }
    }

    /** The tree under tree/ and the cases under cases/, committed on main and pushed to the bare repo. */
    static void seed(Options o, Path repo) throws IOException, InterruptedException, Refused {
        Path seed = Files.createTempDirectory("idmweb-seed");
        try {
            copyTree(o.tree, seed.resolve("tree"));
            Files.createDirectories(seed.resolve("cases"));
            if (o.cases != null && Files.isDirectory(o.cases)) {
                copyTree(o.cases, seed.resolve("cases"));
            }
            Files.writeString(seed.resolve(".gitignore"), "deploy-snapshots/\n.dirxmldev/\n", StandardCharsets.UTF_8);
            String who = o.user;
            git(seed, "init", "-q", "-b", "main");
            git(seed, "add", "-A");
            git(seed, "-c", "user.name=" + who, "-c", "user.email=" + who + "@localhost", "commit", "-q", "-m", "initial tree");
            git(repo.getParent(), "init", "-q", "--bare", "-b", "main", repo.toString());
            git(seed, "push", "-q", repo.toString(), "main");
        } finally {
            deleteRecursively(seed);
        }
    }

    private static void git(Path cwd, String... args) throws IOException, InterruptedException, Refused {
        List<String> cmd = new ArrayList<>();
        cmd.add("git");
        cmd.addAll(List.of(args));
        ProcessBuilder pb = new ProcessBuilder(cmd).directory(cwd.toFile()).redirectErrorStream(true);
        // the container may run as a uid with no home: git needs one for its config lookups
        pb.environment().putIfAbsent("HOME", System.getProperty("java.io.tmpdir"));
        Process p = pb.start();
        String output = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        if (!p.waitFor(120, TimeUnit.SECONDS) || p.exitValue() != 0) {
            throw new Refused("git " + String.join(" ", args) + ": " + output.trim());
        }
    }

    private static void copyTree(Path from, Path to) throws IOException {
        try (Stream<Path> s = Files.walk(from)) {
            for (Path p : (Iterable<Path>) s::iterator) {
                Path rel = from.relativize(p);
                if (rel.toString().equals(".git") || rel.startsWith(".git")) {
                    continue;
                }
                Path dst = to.resolve(rel.toString());
                if (Files.isDirectory(p)) {
                    Files.createDirectories(dst);
                } else {
                    Files.createDirectories(dst.getParent());
                    Files.copy(p, dst, StandardCopyOption.REPLACE_EXISTING);
                }
            }
        }
    }

    private static void deleteRecursively(Path p) throws IOException {
        if (!Files.exists(p)) {
            return;
        }
        try (Stream<Path> s = Files.walk(p)) {
            for (Path x : s.sorted((a, b) -> b.getNameCount() - a.getNameCount()).toList()) {
                Files.deleteIfExists(x);
            }
        }
    }

    private static boolean isEmpty(Path d) throws IOException {
        try (Stream<Path> s = Files.list(d)) {
            return s.findAny().isEmpty();
        }
    }

    private static List<Path> listProperties(Path d) throws IOException {
        try (Stream<Path> s = Files.list(d)) {
            return s.filter(p -> p.getFileName().toString().endsWith(".properties")).toList();
        }
    }

    /** Readable by you alone (on a POSIX file system). */
    static void owner(Path p) throws IOException {
        try {
            Files.setPosixFilePermissions(p, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException ignored) {
            // not a POSIX file system
        }
    }

    static String uid() {
        return id("-u", "1000");
    }

    static String gid() {
        return id("-g", "1000");
    }

    private static String id(String flag, String fallback) {
        try {
            Process p = new ProcessBuilder("id", flag).redirectErrorStream(true).start();
            String v = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            return p.waitFor(5, TimeUnit.SECONDS) && p.exitValue() == 0 && v.matches("\\d+") ? v : fallback;
        } catch (IOException | InterruptedException e) {
            return fallback;
        }
    }
}
