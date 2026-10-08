package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.deploy.Environments;
import com.pointbluetech.dirxml.trace.ldap.CertificateTrust;
import com.pointbluetech.dirxml.trace.ldap.ConnectionSettings;
import com.pointbluetech.dirxml.trace.ldap.LdapTraceEventSource;
import com.pointbluetech.dirxml.trace.model.Channel;
import com.pointbluetech.dirxml.trace.model.FormattedText;
import com.pointbluetech.dirxml.trace.model.TraceHighlighter;
import com.pointbluetech.dirxml.trace.model.TraceParser;
import com.pointbluetech.dirxml.trace.model.TraceRecord;
import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/**
 * Live trace through the DirXML Trace Viewer's library ({@code dirxml-trace-core}): the same
 * parser, channel attribution and highlighting the desktop viewer has, so a line means the same
 * thing in both. One LDAP event registration per server of the driver set carries every driver;
 * the page filters. Each record goes to the page as JSON with its highlighting runs computed here.
 *
 * <p>Certificates: the library asks a prompt about an LDAPS certificate the JVM does not trust.
 * Here the answer comes from the environment: {@code trustAll} accepts it for this run, otherwise
 * it is refused, which is what the vault connections of the core do as well.
 */
public final class TraceService {
    /** host:port of the servers whose environment says trustAll. */
    private static final Set<String> TRUSTED = ConcurrentHashMap.newKeySet();

    static {
        CertificateTrust.setPrompt(req -> TRUSTED.contains(req.host() + ":" + req.port()) ? CertificateTrust.Decision.ONCE : CertificateTrust.Decision.REJECT);
    }

    /** One server to stream from: the name the records carry, and its LDAP URL. */
    public record Source(String name, String url) {
    }

    private TraceService() {
    }

    /**
     * Streams every source until the calling thread is interrupted. {@code driver} null = every
     * driver; otherwise that driver's records (continuations included) and, with {@code engineToo},
     * the engine's own messages. A source that cannot start fails the whole stream; one that fails
     * later sends an {@code error} record and the others go on.
     */
    public static void stream(Environments.Environment env, List<Source> sources, String driver, boolean engineToo, Consumer<Map<String, Object>> sink) throws Exception {
        stream(env, sources, driver, engineToo, sink, null);
    }

    /** As above; {@code raw} (may be null) gets every record before the driver filter, for a recording. */
    public static void stream(Environments.Environment env, List<Source> sources, String driver, boolean engineToo, Consumer<Map<String, Object>> sink, Consumer<TraceRecord> raw) throws Exception {
        List<LdapTraceEventSource> open = new ArrayList<>();
        try {
            for (Source s : sources) {
                ConnectionSettings settings = settings(env, s.url());
                if (env.trustAll) {
                    TRUSTED.add(settings.host() + ":" + settings.port());
                }
                TraceParser parser = new TraceParser();
                LdapTraceEventSource source = new LdapTraceEventSource(settings, s.name());
                source.start(ev -> {
                    TraceRecord r;
                    synchronized (parser) {
                        r = parser.parse(ev);
                    }
                    if (r != null && raw != null) {
                        raw.accept(r);
                    }
                    if (r != null && wanted(r, driver, engineToo)) {
                        sink.accept(json(r));
                    }
                }, e -> sink.accept(Map.of("error", s.name() + ": " + e.getMessage())));
                open.add(source);
            }
            Thread.currentThread().join();
        } finally {
            for (LdapTraceEventSource s : open) {
                s.close();
            }
        }
    }

    static boolean wanted(TraceRecord r, String driver, boolean engineToo) {
        if (driver == null || driver.isBlank()) {
            return true;
        }
        if (r.driverName() == null) {
            return engineToo;
        }
        return r.driverName().equalsIgnoreCase(driver);
    }

    /** The library's connection settings from an environment and one of its servers' LDAP URLs. */
    static ConnectionSettings settings(Environments.Environment env, String url) {
        URI u = URI.create(url.contains("://") ? url : "ldaps://" + url);
        boolean ssl = !"ldap".equalsIgnoreCase(u.getScheme());
        int port = u.getPort() > 0 ? u.getPort() : (ssl ? 636 : 389);
        return new ConnectionSettings(u.getHost(), port, ssl, true, env.bindDn, env.password == null ? new char[0] : env.password.toCharArray(), "");
    }

    /**
     * A record for the page: {@code s} server, {@code t} received-at millis, {@code d} driver name
     * (null for engine messages), {@code c} channel (S, P, V, O), {@code h} header positions
     * [timestampStart, timestampEnd, nameStart, nameEnd, threadStart, threadEnd, end, stamped]
     * or null for a continuation, {@code x} the text, {@code r} highlighting runs
     * [[start, end, token, dsColor]…].
     */
    public static Map<String, Object> json(TraceRecord r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("s", r.server());
        m.put("t", r.receivedAt());
        m.put("d", r.driverName());
        m.put("c", channel(r.channel()));
        TraceRecord.Header h = r.header();
        m.put("h", h == null ? null : List.of(h.timestampStart(), h.timestampEnd(), h.nameStart(), h.nameEnd(), h.threadStart(), h.threadEnd(), h.end(), h.stamped() ? 1 : 0));
        m.put("x", r.text());
        List<Object> runs = new ArrayList<>();
        for (TraceHighlighter.Run run : TraceHighlighter.highlight(r)) {
            runs.add(List.of(run.start(), run.end(), run.token().name(), run.dsColor()));
        }
        m.put("r", runs);
        return m;
    }

    static String channel(Channel c) {
        return switch (c) {
            case SUBSCRIBER -> "S";
            case PUBLISHER -> "P";
            case SERVICE -> "V";
            case OTHER -> "O";
        };
    }

    /** The colour spans alone, for tests and the file index later. */
    static List<FormattedText.ColorSpan> spans(TraceRecord r) {
        return r.colorSpans();
    }
}
