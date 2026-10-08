package com.pointblue.dirxml.web;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.pointblue.dirxml.dev.events.Event;
import com.pointblue.dirxml.dev.events.EventQuery;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

public class EventsServiceTest {
    @Test
    public void thePagesQueryStringBecomesTheCoresSelectors() throws Exception {
        Map<String, String> q = new LinkedHashMap<>();
        q.put("dn", "\\T\\data\\people\\jdoe");
        q.put("rows", "logged");
        q.put("type", "add,modify");
        q.put("class", "User");
        q.put("since", "2026-10-01T00:00:00Z");
        q.put("text", " jdoe ");
        q.put("limit", "50");
        EventQuery query = EventsService.queryOf(q, null);
        assertEquals("\\T\\data\\people\\jdoe", query.dn);
        assertEquals(Boolean.FALSE, query.own);
        assertEquals(List.of("add", "modify"), query.types);
        assertEquals("User", query.className);
        assertEquals(Instant.parse("2026-10-01T00:00:00Z"), query.since);
        assertEquals("jdoe", query.text);
        assertEquals(50, query.limit);
        assertNull(query.under);
        assertNull(query.driverDn);
        try {
            q.put("limit", "many");
            EventsService.queryOf(q, null);
            throw new AssertionError("accepted");
        } catch (TreeService.BadRequest expected) {
            assertTrue(expected.getMessage().contains("limit"));
        }
    }

    @Test
    public void theDefaultCaseNameIsDriverTypeAndTime() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", 7L);
        row.put("eventid", "x#1");
        row.put("classname", "User");
        row.put("eventtype", "add");
        row.put("cachedtime", java.sql.Timestamp.from(Instant.parse("2026-10-07T14:15:02Z")));
        row.put("srcdriver", "\\T\\system\\ds\\Active Directory Driver");
        row.put("schemaversion", (short) 2);
        row.put("eventjson", "{}");
        String name = EventsService.defaultCaseName(Event.fromRow(row));
        assertTrue(name, name.startsWith("Active-Directory-Driver-add-2026"));
        row.put("srcdriver", null);
        assertTrue(EventsService.defaultCaseName(Event.fromRow(row)).startsWith("event-add-"));
    }
}
