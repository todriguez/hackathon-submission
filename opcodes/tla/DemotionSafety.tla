--------------------------- MODULE DemotionSafety ---------------------------
(*
 * Demotion Safety — verifies OP_DEMOTE (0xCB) transition rules.
 *
 * Source: plexus.zig opDemote, validDemotion function
 *
 * Properties:
 * - Only LINEAR objects can be demoted
 * - Valid targets: AFFINE, RELEVANT only
 * - No promotion (AFFINE/RELEVANT cannot become LINEAR)
 * - Consumed objects cannot be demoted
 *)

EXTENDS Naturals, FiniteSets, TLC

CONSTANTS
    ResourceIds,
    Actors,
    TxIds,
    NULL

LinearityTypes == {"LINEAR", "AFFINE", "RELEVANT"}

ObjectState == [
    linearity    : LinearityTypes,
    consumed     : BOOLEAN,
    demotedFrom  : LinearityTypes \cup {NULL}
]

VARIABLES objects

vars == <<objects>>

Init ==
    objects = [r \in ResourceIds |-> [
        linearity   |-> "LINEAR",
        consumed    |-> FALSE,
        demotedFrom |-> NULL
    ]]

ConsumeLinear(r) ==
    /\ objects[r].linearity = "LINEAR"
    /\ ~objects[r].consumed
    /\ objects' = [objects EXCEPT ![r].consumed = TRUE]

DemoteToAffine(r) ==
    /\ objects[r].linearity = "LINEAR"
    /\ ~objects[r].consumed
    /\ objects' = [objects EXCEPT ![r] = [
           linearity   |-> "AFFINE",
           consumed    |-> FALSE,
           demotedFrom |-> "LINEAR"
       ]]

DemoteToRelevant(r) ==
    /\ objects[r].linearity = "LINEAR"
    /\ ~objects[r].consumed
    /\ objects' = [objects EXCEPT ![r] = [
           linearity   |-> "RELEVANT",
           consumed    |-> FALSE,
           demotedFrom |-> "LINEAR"
       ]]

Next ==
    \E r \in ResourceIds :
        \/ ConsumeLinear(r)
        \/ DemoteToAffine(r)
        \/ DemoteToRelevant(r)

Spec == Init /\ [][Next]_vars

\* --- Invariants ---

NoPromotion ==
    \A r \in ResourceIds :
        objects[r].demotedFrom /= NULL =>
            objects[r].demotedFrom = "LINEAR"

DemotedFromLinearOnly ==
    \A r \in ResourceIds :
        objects[r].demotedFrom /= NULL =>
            /\ objects[r].demotedFrom = "LINEAR"
            /\ objects[r].linearity \in {"AFFINE", "RELEVANT"}

TypeInv ==
    \A r \in ResourceIds : objects[r] \in ObjectState

ConsumedIsLinear ==
    \A r \in ResourceIds :
        objects[r].consumed => objects[r].linearity = "LINEAR"

=============================================================================
