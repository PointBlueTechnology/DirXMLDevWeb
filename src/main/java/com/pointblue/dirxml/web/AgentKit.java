package com.pointblue.dirxml.web;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * The agent kit (docs/agents.md): this version's AGENTS.md, CLAUDE.md, skills and docs for an agent working with the
 * server, with the server's version and MCP address filled in. The image carries it at
 * {@code /opt/idmweb/agent-kit}; {@code IDMWEB_AGENT_KIT} names another folder (a checkout's {@code hosted/agent-kit}
 * when developing).
 */
final class AgentKit {

    private AgentKit() {
    }

    /** The kit's folder, or null when this server has none. */
    static Path locate() {
        for (String c : new String[] {System.getenv("IDMWEB_AGENT_KIT"),
            System.getenv("IDM_HOME") == null ? null : System.getenv("IDM_HOME") + "/agent-kit", "/opt/idmweb/agent-kit"}) {
            if (c != null && Files.isDirectory(Path.of(c))) {
                return Path.of(c);
            }
        }
        return null;
    }

    /** A text file's content with the placeholders filled; other files as they are. */
    static byte[] content(Path file, String version, String mcpUrl) throws IOException {
        byte[] raw = Files.readAllBytes(file);
        String name = file.getFileName().toString();
        if (!name.endsWith(".md") && !name.endsWith(".txt")) {
            return raw;
        }
        return new String(raw, StandardCharsets.UTF_8).replace("{{VERSION}}", version).replace("{{MCP_URL}}", mcpUrl).getBytes(StandardCharsets.UTF_8);
    }

    static List<Path> files(Path kit) throws IOException {
        try (Stream<Path> s = Files.walk(kit)) {
            return s.filter(Files::isRegularFile).sorted().toList();
        }
    }

    /** The kit as a zip, its files under {@code agent-kit/}. */
    static void zip(Path kit, String version, String mcpUrl, OutputStream out) throws IOException {
        try (ZipOutputStream z = new ZipOutputStream(out)) {
            for (Path f : files(kit)) {
                z.putNextEntry(new ZipEntry("agent-kit/" + kit.relativize(f).toString().replace('\\', '/')));
                z.write(content(f, version, mcpUrl));
                z.closeEntry();
            }
        }
    }

    /** The kit written into {@code target} (setup's {@code agent/}), replacing what an earlier version wrote there. */
    static int write(Path kit, Path target, String version, String mcpUrl) throws IOException {
        int n = 0;
        for (Path f : files(kit)) {
            Path to = target.resolve(kit.relativize(f).toString());
            Files.createDirectories(to.getParent());
            Files.write(to, content(f, version, mcpUrl));
            n++;
        }
        return n;
    }
}
