package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.deploy.Environments;
import com.pointblue.dirxml.dev.events.Event;
import com.pointblue.dirxml.dev.events.EventMask;
import com.pointblue.dirxml.dev.events.EventQuery;
import com.pointblue.dirxml.dev.events.EventStore;
import com.pointblue.dirxml.dev.events.EventsCase;
import com.pointblue.dirxml.dev.events.EventsCli;
import java.io.IOException;
import java.nio.file.Path;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The Event Logger's store for the page (docs/event-logger.md): the rows an environment's store
 * holds, one row with its modify diff and the other rows of the same engine event, and a row
 * saved as a simulator case in the tree's {@code cases/}. Reads go through the core's read-only
 * {@code EventStore}; the only write is the case directory. A store flagged
 * {@code eventsPseudonymise} is masked before anything leaves the server.
 */
public final class EventsService {
    private final Path tree;
    /** the simulator's case directory, so a saved case is where the simulator view lists it */
    private final Path cases;
    private final EnvFiles files;

    public EventsService(Path tree, Path cases, EnvFiles files) {
        this.tree = tree;
        this.cases = cases;
        this.files = files;
    }

    private Environments.Environment env(String name) throws IOException {
        if (name == null || name.isBlank()) {
            throw new TreeService.BadRequest("no environment named");
        }
        Environments.Environment e = files.load().get(name);
        if (e.events == null) {
            throw new TreeService.BadRequest("environment '" + name + "' has no event store: set " + name + ".eventsUrl, eventsUser and eventsPassword… in the environments file");
        }
        return e;
    }

    /** Whether the environment names a store, and what it holds. */
    public Map<String, Object> describe(String envName) throws IOException {
        Map<String, Object> m = new LinkedHashMap<>();
        Environments.Environment e;
        try {
            e = env(envName);
        } catch (TreeService.BadRequest b) {
            m.put("environment", envName);
            m.put("configured", false);
            m.put("message", b.getMessage());
            return m;
        }
        m.put("environment", e.name);
        m.put("configured", true);
        m.put("pseudonymise", e.events.pseudonymise);
        try (EventStore store = EventStore.open(e)) {
            m.putAll(store.describe());
            List<Map<String, Object>> drivers = new ArrayList<>();
            for (String dn : store.drivers()) {
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("dn", dn);
                d.put("name", Event.leaf(dn));
                drivers.add(d);
            }
            m.put("drivers", drivers);
            m.put("ok", true);
        } catch (IOException ex) {
            m.put("ok", false);
            m.put("message", ex.getMessage());
        }
        return m;
    }

    /** The rows the selectors choose, as the page lists them (no XML, the JSON included). */
    public Map<String, Object> list(String envName, Map<String, String> q) throws IOException {
        Environments.Environment e = env(envName);
        try (EventStore store = EventStore.open(e)) {
            EventQuery query = queryOf(q, store);
            List<Event> rows = store.query(query);
            EventMask mask = e.events.pseudonymise ? new EventMask() : null;
            List<Object> out = new ArrayList<>();
            for (Event ev : rows) {
                out.add((mask == null ? ev : mask.mask(ev)).toMap(false));
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("environment", e.name);
            m.put("count", out.size());
            m.put("limit", Math.min(query.limit, EventQuery.MAX_LIMIT));
            m.put("events", out);
            return m;
        }
    }

    /** One row with its XML and the other rows of the same engine event. */
    public Map<String, Object> get(String envName, long id) throws IOException {
        Environments.Environment e = env(envName);
        try (EventStore store = EventStore.open(e)) {
            Event ev = store.get(id);
            if (ev == null) {
                throw new TreeService.NotFound("no row " + id);
            }
            EventMask mask = e.events.pseudonymise ? new EventMask() : null;
            if (mask != null) {
                ev = mask.mask(ev);
            }
            Map<String, Object> m = new LinkedHashMap<>(ev.toMap(true));
            List<Object> others = new ArrayList<>();
            if (ev.eventId() != null) {
                for (Event f : store.siblings(ev.eventId())) {
                    if (f.id() != ev.id()) {
                        others.add((mask == null ? f : mask.mask(f)).toMap(false));
                    }
                }
            }
            m.put("sameEvent", others);
            return m;
        }
    }

    /**
     * A row as a case: {@code dryRun} plans and returns the files; otherwise writes
     * {@code <name>/} into the simulator's case directory (the tree's {@code cases/}, or the one beside it). {@code driver} null = the row's driver, which must be in
     * the tree; {@code channel} null = the row's, else subscriber.
     */
    public Map<String, Object> saveCase(String envName, long id, String name, String driver, String channel, boolean replace, boolean dryRun) throws IOException {
        Environments.Environment e = env(envName);
        try (EventStore store = EventStore.open(e)) {
            Event ev = store.get(id);
            if (ev == null) {
                throw new TreeService.NotFound("no row " + id);
            }
            boolean masked = e.events.pseudonymise;
            if (masked) {
                ev = new EventMask().mask(ev);
            }
            String caseName = name == null || name.isBlank() ? defaultCaseName(ev) : name.trim();
            EventsCase.Plan p = EventsCase.plan(tree, ev, e.name, caseName, driver, channel, cases, replace, masked);
            if (p.refusal == null && !dryRun) {
                EventsCase.write(p);
            }
            Map<String, Object> m = p.toMap();
            m.put("name", caseName);
            m.put("written", p.refusal == null && !dryRun);
            return m;
        }
    }

    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmm").withZone(ZoneId.systemDefault());

    /** {@code <driver>-<type>-<yyyymmdd-hhmm>}, the name the page suggests. */
    public static String defaultCaseName(Event ev) {
        String driver = ev.driverName() == null ? "event" : ev.driverName().replaceAll("[^A-Za-z0-9._-]+", "-");
        String when = ev.time() == null ? String.valueOf(ev.id()) : STAMP.format(ev.time());
        return driver + "-" + ev.type() + "-" + when;
    }

    /** The page's query string as the core's selectors (the same names as {@code query events}). */
    static EventQuery queryOf(Map<String, String> q, EventStore store) throws IOException {
        EventQuery query = new EventQuery();
        String tree = store == null ? null : store.config().tree;
        query.dn = blank(q.get("dn")) ? null : EventsCli.slash(q.get("dn").trim(), tree, store);
        query.under = blank(q.get("under")) ? null : EventsCli.slash(q.get("under").trim(), tree, store);
        query.name = blank(q.get("name")) ? null : q.get("name").trim();
        if (!blank(q.get("driver"))) {
            String d = q.get("driver").trim();
            query.driverDn = d.startsWith("\\") ? d : EventsCli.driverDn(d, store);
        }
        query.policy = blank(q.get("policy")) ? null : q.get("policy").trim();
        query.stage = blank(q.get("stage")) ? null : q.get("stage").trim();
        if ("own".equals(q.get("rows"))) {
            query.own = true;
        } else if ("logged".equals(q.get("rows"))) {
            query.own = false;
        }
        if (!blank(q.get("type"))) {
            query.types = EventQuery.types(q.get("type"));
        }
        query.className = blank(q.get("class")) ? null : q.get("class").trim();
        if (!blank(q.get("since"))) {
            query.since = EventQuery.parseTime(q.get("since"));
        }
        if (!blank(q.get("until"))) {
            query.until = EventQuery.parseTime(q.get("until"));
        }
        query.eventId = blank(q.get("eventId")) ? null : q.get("eventId").trim();
        query.text = blank(q.get("text")) ? null : q.get("text").trim();
        query.attr = blank(q.get("attr")) ? null : q.get("attr").trim();
        if (!blank(q.get("limit"))) {
            try {
                query.limit = Integer.parseInt(q.get("limit").trim());
            } catch (NumberFormatException e) {
                throw new TreeService.BadRequest("limit is a number");
            }
        }
        return query;
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
