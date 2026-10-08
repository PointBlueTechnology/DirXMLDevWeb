package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.Test;
import org.w3c.dom.Element;

public class CacheEventsTest {
    private static final String INPUT = "<nds dtdversion=\"4.0\"><input>"
        + "<add class-name=\"User\" event-id=\"e1\" src-dn=\"\\T\\data\\jdoe\"><add-attr attr-name=\"CN\"><value>jdoe</value></add-attr></add>"
        + "<modify class-name=\"Group\" event-id=\"e2\" qualified-src-dn=\"O=data\\CN=admins\"/>"
        + "<delete class-name=\"User\" event-id=\"e3\" src-dn=\"\\T\\data\\old\"/>"
        + "</input></nds>";

    @Test
    public void theEventsOfTheInputDocumentInOrderWithTheirSummaries() {
        List<Element> events = CacheEvents.events(INPUT);
        assertEquals(3, events.size());
        Map<String, Object> first = CacheEvents.summary(0, events.get(0), true);
        assertEquals(1, first.get("index"));
        assertEquals("add", first.get("operation"));
        assertEquals("User", first.get("className"));
        assertEquals("\\T\\data\\jdoe", first.get("srcDn"));
        assertEquals("e1", first.get("eventId"));
        assertTrue(String.valueOf(first.get("xml")).contains("<add-attr"));
        Map<String, Object> second = CacheEvents.summary(1, events.get(1), false);
        assertEquals("O=data\\CN=admins", second.get("srcDn"));
        assertTrue(!second.containsKey("xml"));
        assertEquals("jdoe", CacheEvents.leaf(events.get(0)));
        assertEquals("", CacheEvents.leaf(CacheEvents.events("<nds><input><sync class-name=\"User\"/></input></nds>").get(0)));
        assertTrue(CacheEvents.events("").isEmpty());
        assertTrue(CacheEvents.events("<nds/>").isEmpty());
    }

    @Test
    public void oneEventBecomesASimulatorInput() {
        Element del = CacheEvents.events(INPUT).get(2);
        String xds = CacheEvents.inputOf(del);
        assertTrue(xds, xds.contains("<nds dtdversion=\"4.0\">") && xds.contains("<input>") && xds.contains("<delete") && !xds.contains("<add"));
        assertEquals(1, CacheEvents.events(xds).size());
    }
}
