package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.pointbluetech.dirxml.trace.model.RawTraceEvent;
import com.pointbluetech.dirxml.trace.model.TraceParser;
import com.pointbluetech.dirxml.trace.model.TraceRecord;
import java.util.List;
import java.util.Map;
import org.junit.Test;

public class TraceServiceTest {
    private static final int DRIVERS = 217;

    private static TraceRecord parse(TraceParser p, String format) {
        return p.parse(new RawTraceEvent("idm1", DRIVERS, 1_700_000_000_000L, "", format, List.of()));
    }

    @Test
    public void aDriverLineBecomesARecordWithHeaderChannelAndRuns() {
        TraceParser p = new TraceParser();
        TraceRecord r = parse(p, "AD ST:Applying policy: %+C%14CNOVLADDCFG-sub-ctp%-C.\n");
        Map<String, Object> m = TraceService.json(r);
        assertEquals("idm1", m.get("s"));
        assertEquals("AD", m.get("d"));
        assertEquals("S", m.get("c"));
        assertNotNull("a header", m.get("h"));
        assertTrue(String.valueOf(m.get("x")).contains("Applying policy"));
        List<?> runs = (List<?>) m.get("r");
        assertFalse(runs.isEmpty());
        for (Object o : runs) {
            List<?> run = (List<?>) o;
            assertEquals(4, run.size());
        }
        assertEquals("a policy is a jump marker", "POLICY", m.get("k"));
        assertTrue("a live record's stamped header has a time of day", ((Number) m.get("tm")).longValue() >= 0);
    }

    @Test
    public void aContinuationKeepsTheDriverAndHasNoHeader() {
        TraceParser p = new TraceParser();
        parse(p, "AD PT:\n<nds dtdversion=\"4.0\">\n");
        TraceRecord r = parse(p, "  <input/>\n");
        Map<String, Object> m = TraceService.json(r);
        assertEquals("AD", m.get("d"));
        assertEquals("P", m.get("c"));
        assertNull(m.get("h"));
        assertNull(m.get("k"));
        assertEquals(-1L, ((Number) m.get("tm")).longValue());
    }

    @Test
    public void theDriverFilterKeepsContinuationsAndOptionallyTheEngine() {
        TraceParser p = new TraceParser();
        TraceRecord ad = parse(p, "AD ST:hello\n");
        TraceRecord cont = parse(p, "  more\n");
        // a line with no header and no driver before it is the engine's own
        TraceRecord engine = parse(new TraceParser(), "DirXML Log Event -------------------\n");
        assertTrue(TraceService.wanted(ad, "ad", false));
        assertTrue(TraceService.wanted(cont, "AD", false));
        assertFalse(TraceService.wanted(engine, "AD", false));
        assertTrue(TraceService.wanted(engine, "AD", true));
        assertTrue(TraceService.wanted(engine, null, false));
    }

    @Test
    public void connectionSettingsComeFromTheUrl() {
        com.pointblue.dirxml.dev.deploy.Environments.Environment e = env();
        var s = TraceService.settings(e, "ldaps://idm1.example:1636");
        assertEquals("idm1.example", s.host());
        assertEquals(1636, s.port());
        assertTrue(s.ssl());
        var plain = TraceService.settings(e, "ldap://idm2.example");
        assertEquals(389, plain.port());
        assertFalse(plain.ssl());
        assertEquals(636, TraceService.settings(e, "idm3.example").port());
    }

    private static com.pointblue.dirxml.dev.deploy.Environments.Environment env() {
        try {
            java.nio.file.Path f = java.nio.file.Files.createTempFile("env", ".properties");
            java.nio.file.Files.writeString(f, "lab.url=ldaps://idm1.example:636\nlab.bindDn=cn=admin,o=sys\nlab.password=x\nlab.driverSet=cn=ds,o=sys\nlab.tier=dev\n");
            return com.pointblue.dirxml.dev.deploy.Environments.load(f).get("lab");
        } catch (java.io.IOException ex) {
            throw new IllegalStateException(ex);
        }
    }

    /** #3 of the trace viewer: a record's fold placement goes to the page as fo, fw and fx, each only when there is one. */
    @Test
    public void foldPlacementsGoToThePage() {
        com.pointbluetech.dirxml.trace.model.TraceFolds folds = new com.pointbluetech.dirxml.trace.model.TraceFolds();
        TraceParser p = new TraceParser();
        TraceRecord set = p.parseText("", "[10/14/26 10:00:00.000]:AD ST:Applying event transformation policies.\n");
        Map<String, Object> m = TraceService.json(set, folds.add(set));
        assertEquals(List.of(List.of(0, "POLICY_SET", -1, "Applying event transformation policies.")), m.get("fo"));
        assertNull(m.get("fw"));
        TraceRecord pol = p.parseText("", "[10/14/26 10:00:00.100]:AD ST:Applying policy: one.\n");
        Map<String, Object> m2 = TraceService.json(pol, folds.add(pol));
        assertEquals(0, m2.get("fw"));
        TraceRecord doc = p.parseText("", "[10/14/26 10:00:00.200]:AD ST:Policy returned:\n<nds>\n  <input/>\n</nds>\n");
        Map<String, Object> m3 = TraceService.json(doc, folds.add(doc));
        assertEquals(1, m3.get("fw"));
        assertEquals(List.of(List.of(1, 3)), m3.get("fx"));
        assertNull("no fold fields without a placement", TraceService.json(doc).get("fx"));
    }

    @Test
    public void aServerThatCannotBeReachedIsReportedAndTheOthersStreamOn() throws Exception {
        List<TraceService.Source> sources = List.of(new TraceService.Source("idm1", "ldaps://idm1:636"), new TraceService.Source("idm2", "ldaps://10.0.0.2:636"));
        List<Map<String, Object>> sink = new java.util.ArrayList<>();
        List<String> started = TraceService.startEach(sources, s -> {
            if (s.name().equals("idm2")) {
                throw new java.io.IOException("Connection refused");
            }
            return s.name();
        }, sink::add);
        assertEquals(List.of("idm1"), started);
        assertEquals(1, sink.size());
        String error = String.valueOf(sink.get(0).get("error"));
        assertTrue(error, error.contains("idm2 (ldaps://10.0.0.2:636): Connection refused") && error.contains("servers="));
    }

    @Test
    public void whenNoServerCanBeReachedTheStreamFails() {
        List<TraceService.Source> sources = List.of(new TraceService.Source("idm1", "ldaps://idm1:636"));
        List<Map<String, Object>> sink = new java.util.ArrayList<>();
        try {
            TraceService.startEach(sources, s -> {
                throw new java.io.IOException("Connection refused");
            }, sink::add);
            org.junit.Assert.fail("expected the stream to fail");
        } catch (Exception e) {
            assertEquals("Connection refused", e.getMessage());
        }
        assertTrue(sink.isEmpty());
    }
}
