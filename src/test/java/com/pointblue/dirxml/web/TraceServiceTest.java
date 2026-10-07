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
}
