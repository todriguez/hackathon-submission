--------------------------- MODULE SemanticTypes ---------------------------
(*
 * Base types and operators for Semantos protocol verification.
 *
 * Source files:
 *   src/types/semantic-objects.ts — SemanticType enum, object interfaces
 *   src/compiler/validator.ts     — isConsumed, canConsume logic
 *   src/cell-engine/typeHashRegistry.ts — linearity values (1=LINEAR, 2=AFFINE, 3=RELEVANT)
 *
 * This module defines the shared type system used by all other specs.
 *)

EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS
    Actors,        \* Set of actor identifiers (model values)
    ResourceIds,   \* Set of resource identifiers (model values)
    TxIds,         \* Set of transaction identifiers (model values)
    NULL           \* Distinguished null value (model value)

(*
 * Semantic types matching src/types/semantic-objects.ts SemanticType enum.
 * Binary encoding from typeHashRegistry.ts: LINEAR=1, AFFINE=2, RELEVANT=3
 *)
SemanticTypes == {"LINEAR", "AFFINE", "RELEVANT"}

(*
 * Object record types matching src/types/semantic-objects.ts interfaces.
 *
 * LinearObject (lines 80-92): consumed, consumedBy, consumptionTxId
 * AffineObject (lines 102-113): acknowledged, discarded
 * RelevantObject (lines 123-132): revocation (null or proof record)
 *)
LinearObjectType == [
    type         : {"LINEAR"},
    consumed     : BOOLEAN,
    consumedBy   : Actors \cup {NULL},
    consumptionTxId : TxIds \cup {NULL}
]

AffineObjectType == [
    type         : {"AFFINE"},
    acknowledged : BOOLEAN,
    discarded    : BOOLEAN
]

RelevantObjectType == [
    type       : {"RELEVANT"},
    revoked    : BOOLEAN,
    revokedBy  : Actors \cup {NULL}
]

ObjectType == LinearObjectType \cup AffineObjectType \cup RelevantObjectType

\* --- State variables ---

VARIABLES objects

vars == <<objects>>

\* --- Operators matching src/compiler/validator.ts ---

(*
 * CanConsume: mirrors validator.ts canConsume (lines 297-311)
 *   LINEAR  => !consumed
 *   AFFINE  => !(acknowledged || discarded)
 *   RELEVANT => revocation === null
 *)
CanConsume(obj) ==
    CASE obj.type = "LINEAR"   -> ~obj.consumed
      [] obj.type = "AFFINE"   -> ~obj.acknowledged /\ ~obj.discarded
      [] obj.type = "RELEVANT" -> ~obj.revoked

(*
 * IsConsumed: mirrors validator.ts isConsumed (lines 271-285)
 *   LINEAR  => consumed
 *   AFFINE  => acknowledged || discarded
 *   RELEVANT => revocation !== null
 *)
IsConsumed(obj) ==
    CASE obj.type = "LINEAR"   -> obj.consumed
      [] obj.type = "AFFINE"   -> obj.acknowledged \/ obj.discarded
      [] obj.type = "RELEVANT" -> obj.revoked

\* --- Initial state ---

InitLinear(r) == [
    type            |-> "LINEAR",
    consumed        |-> FALSE,
    consumedBy      |-> NULL,
    consumptionTxId |-> NULL
]

InitAffine(r) == [
    type         |-> "AFFINE",
    acknowledged |-> FALSE,
    discarded    |-> FALSE
]

InitRelevant(r) == [
    type      |-> "RELEVANT",
    revoked   |-> FALSE,
    revokedBy |-> NULL
]

Init ==
    objects \in [ResourceIds -> {InitLinear("x"), InitAffine("x"), InitRelevant("x")}]

\* --- Actions ---

(*
 * ConsumeLinear: mirrors validator.ts validateConsumption (lines 62-82)
 * Guard: !consumed (line 66)
 * Effect: consumed=true, consumedBy=actor, consumptionTxId=txId
 *)
ConsumeLinear(r, actor, txId) ==
    /\ objects[r].type = "LINEAR"
    /\ ~objects[r].consumed
    /\ objects' = [objects EXCEPT ![r] = [
           objects[r] EXCEPT
               !.consumed = TRUE,
               !.consumedBy = actor,
               !.consumptionTxId = txId
       ]]

(*
 * AcknowledgeAffine: mirrors validator.ts validateAcknowledgement (lines 94-107)
 * Guard: !discarded (line 97)
 *)
AcknowledgeAffine(r) ==
    /\ objects[r].type = "AFFINE"
    /\ ~objects[r].discarded
    /\ objects' = [objects EXCEPT ![r].acknowledged = TRUE]

(*
 * DiscardAffine: mirrors validator.ts validateDiscard (lines 119-136)
 * Guard: !acknowledged (line 122) AND !discarded (line 127)
 *)
DiscardAffine(r) ==
    /\ objects[r].type = "AFFINE"
    /\ ~objects[r].acknowledged
    /\ ~objects[r].discarded
    /\ objects' = [objects EXCEPT ![r].discarded = TRUE]

(*
 * RevokeRelevant: mirrors validator.ts validateRevocation (lines 149-163)
 * Guard: revocation === null (line 153)
 *)
RevokeRelevant(r, actor) ==
    /\ objects[r].type = "RELEVANT"
    /\ ~objects[r].revoked
    /\ objects' = [objects EXCEPT ![r] = [
           objects[r] EXCEPT
               !.revoked = TRUE,
               !.revokedBy = actor
       ]]

(*
 * DemoteLinearToAffine: OP_DEMOTE (0xCB) — demote a LINEAR object to AFFINE.
 * Guard: object must be LINEAR AND not yet consumed.
 * Effect: object becomes AFFINE with acknowledged=FALSE, discarded=FALSE.
 * Source: plexus.zig opDemote — validDemotion(.linear, .affine) = true
 *)
DemoteLinearToAffine(r) ==
    /\ objects[r].type = "LINEAR"
    /\ ~objects[r].consumed
    /\ objects' = [objects EXCEPT ![r] = [
           type         |-> "AFFINE",
           acknowledged |-> FALSE,
           discarded    |-> FALSE
       ]]

(*
 * DemoteLinearToRelevant: OP_DEMOTE (0xCB) — demote a LINEAR object to RELEVANT.
 * Guard: object must be LINEAR AND not yet consumed.
 * Effect: object becomes RELEVANT with revoked=FALSE, revokedBy=NULL.
 * Source: plexus.zig opDemote — validDemotion(.linear, .relevant) = true
 *)
DemoteLinearToRelevant(r) ==
    /\ objects[r].type = "LINEAR"
    /\ ~objects[r].consumed
    /\ objects' = [objects EXCEPT ![r] = [
           type      |-> "RELEVANT",
           revoked   |-> FALSE,
           revokedBy |-> NULL
       ]]

Next ==
    \E r \in ResourceIds :
        \/ \E a \in Actors, tx \in TxIds : ConsumeLinear(r, a, tx)
        \/ AcknowledgeAffine(r)
        \/ DiscardAffine(r)
        \/ \E a \in Actors : RevokeRelevant(r, a)
        \/ DemoteLinearToAffine(r)
        \/ DemoteLinearToRelevant(r)

Spec == Init /\ [][Next]_vars

\* --- Invariants ---

(*
 * TypeInv: all objects remain well-typed throughout execution.
 *)
TypeInv ==
    \A r \in ResourceIds : objects[r] \in ObjectType

(*
 * LinearAtMostOnce: a consumed LINEAR object always has a valid proof.
 * Matches validateConsumption postcondition: consumed => consumedBy /= null.
 *)
LinearAtMostOnce ==
    \A r \in ResourceIds :
        objects[r].type = "LINEAR" =>
            (objects[r].consumed => objects[r].consumedBy /= NULL)

(*
 * AffineExclusion: an AFFINE object cannot be both acknowledged and discarded.
 * Matches the mutual exclusion from validateAcknowledgement (line 97) and
 * validateDiscard (line 122).
 *)
AffineExclusion ==
    \A r \in ResourceIds :
        objects[r].type = "AFFINE" =>
            ~(objects[r].acknowledged /\ objects[r].discarded)

(*
 * RevokedHasProof: a revoked RELEVANT object records who revoked it.
 *)
RevokedHasProof ==
    \A r \in ResourceIds :
        objects[r].type = "RELEVANT" =>
            (objects[r].revoked => objects[r].revokedBy /= NULL)

(*
 * ConsistentConsumeCanConsume: IsConsumed and CanConsume are complementary.
 *)
ConsistentConsumeCanConsume ==
    \A r \in ResourceIds :
        IsConsumed(objects[r]) => ~CanConsume(objects[r])

=============================================================================
