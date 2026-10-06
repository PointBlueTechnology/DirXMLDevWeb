package com.pointblue.dirxml.web;

import com.pointblue.dirxml.dev.edit.Operation;
import com.pointblue.dirxml.dev.edit.Transaction;
import com.pointblue.dirxml.dev.model.DriverSet;
import java.io.IOException;
import java.util.List;

/**
 * Several operations as one: applied in order to the same model inside one transaction, so an
 * editor's whole change set is validated once and written together or not at all. A refusal
 * from any member refuses the batch.
 */
final class Batch implements Operation {

    private final List<Operation> members;

    Batch(List<Operation> members) {
        this.members = members;
    }

    @Override
    public String name() {
        return members.size() == 1 ? members.get(0).name() : "batch(" + members.size() + ")";
    }

    @Override
    public void apply(DriverSet ds, Transaction tx) throws Refusal, IOException {
        int i = 0;
        for (Operation op : members) {
            i++;
            try {
                op.apply(ds, tx);
            } catch (Refusal r) {
                throw members.size() == 1 ? r : new Refusal("change " + i + " of " + members.size() + " (" + op.name() + "): " + r.getMessage());
            }
        }
    }
}
