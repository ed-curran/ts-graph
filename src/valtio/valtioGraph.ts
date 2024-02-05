import {
  GraphSchemaAny,
  IncomingRelationship,
  InferDiscriminatedEntityWithId,
  InferGraphRootResolvedEntity,
  InferGraphView,
  InferPoolEntityName,
  InferPoolEntityWithId,
  InferPoolModel,
  InferPoolRootEntityWithId,
  InferView,
  OutgoingRelationship,
  PoolSchemaAny,
} from '../core';
import { Op, ValtioPool } from './valtioPool';
import { keyFromArrayMapPath } from './proxyArrayMap';

/*
  Warning this code is ugly as hell.
  I want to make sure I can get local and remote persistence working first before I clean this up
*/

type EntityWithIdAny = { readonly id: string; [key: string]: any };

type Ref<S extends GraphSchemaAny> =
  | {
      type: 'source';
      fieldName: string;
      relation: OutgoingRelationship<InferPoolModel<S['poolSchema']>>;
    }
  | {
      type: 'materialisedOutgoing';
      fieldName: string;
      relation: OutgoingRelationship<InferPoolModel<S['poolSchema']>>;
    }
  | {
      type: 'materialisedIncoming';
      fieldName: string;
      relation: IncomingRelationship<InferPoolModel<S['poolSchema']>>;
    };
type ViewIndex<S extends GraphSchemaAny> = {
  view: InferGraphView<S>;
  fieldRelations: Map<string, Ref<S>>;
};
type ViewMap<S extends GraphSchemaAny> = Map<
  InferGraphView<S>['model']['name'],
  ViewIndex<S>
>;

function entityFieldRef(entityId: string, field: string) {
  return `${entityId}/${field}`;
}
function entityPathRef(entityId: string, path: (string | symbol)[]) {
  return `${entityId}/${path.join('.')}`;
}

export interface ValtioGraphOptions {}

export class ValtioGraph<S extends GraphSchemaAny> {
  private readonly schema: S;
  private readonly viewMap: ViewMap<S>;
  private readonly handledEntityFieldRefs: Map<
    InferPoolEntityName<S['poolSchema']>,
    Set<string>
  >;

  private readonly pool: ValtioPool<S['poolSchema']>;

  private onPoolEntityChange(
    name: InferPoolEntityName<S['poolSchema']>,
    viewIndex: ViewIndex<S>,
    ops: Op[],
  ) {
    const entityTable = this.pool.getState().getEntityTable(name);

    for (const change of ops) {
      const [op, path, current, prev] = change;
      if (path.length < 2) {
        //?
      } else if (path.length === 2) {
      } else if (path.length === 3) {
        //entity in pool replaced (this shouldn't happen?)
        const entityId = path[2]!;
        const entity = current as InferPoolEntityWithId<S['poolSchema']>;
      } else if (path.length > 3) {
        //we can get the name of the actually field by looking at the end of the path
        //this works when setting
        //if this path is setting an array, then the field itself won't be a
        const fieldName = path[3] as string;
        const fieldPath = path.slice(3, 5);

        const fieldRel = viewIndex.fieldRelations.get(fieldName);

        if (!fieldRel) {
          continue;
        }
        //grosss
        if (fieldRel.relation.source.type === 'single' && path.length > 4) {
          continue;
        } else if (
          fieldRel.relation.source.type === 'collection' &&
          path.length > 5
        ) {
          continue;
        }

        const entityId = keyFromArrayMapPath(entityTable, path);
        const fieldRef = entityPathRef(entityId, fieldPath);
        const handledEntityFieldRefs = this.handledEntityFieldRefs.get(name)!;
        const handled = handledEntityFieldRefs.has(fieldRef);
        if (handled) {
          handledEntityFieldRefs.delete(fieldRef);
          continue;
        }

        //don't understand why this cast is necessary
        const entity = this.pool.getEntity(name, entityId) as
          | { readonly id: string; [key: string]: any }
          | undefined;
        if (!entity) break;

        switch (fieldRel.type) {
          case 'source': {
            if (
              fieldRel.relation.source.type === 'single' &&
              fieldRel.relation.target.type === 'single'
            ) {
              if (path.length > 4) {
                continue;
              }
              //one to one
              const currentTargetId = current as string;
              const prevTargetId = prev as string;

              const targets = getTargets(
                this.pool,
                fieldRel.relation.target.model.name,
                { current: currentTargetId, prev: prevTargetId },
              );

              singleToSingle(
                {
                  entity,
                  field: undefined, //this is the field that changed so ignore it
                  materialisedAs: fieldRel.relation.source.materializedAs,
                },
                {
                  currentEntity: targets.current,
                  prevEntity: targets.prev,
                  materialisedAs: fieldRel.relation.target.field,
                },
                handledEntityFieldRefs,
              );
            } else if (
              fieldRel.relation.source.type === 'single' &&
              fieldRel.relation.target.type === 'collection'
            ) {
              if (path.length > 4) {
                continue;
              }
              const currentTargetId = current as string;
              const prevTargetId = prev as string;

              const targets = getTargets(
                this.pool,
                fieldRel.relation.target.model.name,
                { current: currentTargetId, prev: prevTargetId },
              );

              singleToCollection(
                {
                  entity,
                  field: undefined, //ignore this
                  materialisedAs: fieldRel.relation.source.materializedAs,
                },
                {
                  currentEntity: targets.current,
                  prevEntity: targets.prev,
                  materialisedAs: fieldRel.relation.target.field,
                },
                handledEntityFieldRefs,
              );
              //many to one
            } else if (
              fieldRel.relation.source.type === 'collection' &&
              fieldRel.relation.target.type === 'single'
            ) {
              if (path.length > 5) {
                continue;
              }
              if (path.length === 4) {
                continue;
              }
              const currentTargetId = current as string;
              const prevTargetId = prev as string;

              const targets = getTargets(
                this.pool,
                fieldRel.relation.target.model.name,
                { current: currentTargetId, prev: prevTargetId },
              );

              collectionToSingle(
                {
                  entity,
                  field: undefined, //ignore this
                  materialisedAs: fieldRel.relation.source.materializedAs,
                },
                {
                  currentEntity: targets.current,
                  prevEntity: targets.prev,
                  materialisedAs: fieldRel.relation.target.field,
                },
                handledEntityFieldRefs,
              );
            }
            break;
          }
          case 'materialisedOutgoing': {
            if (
              fieldRel.relation.source.type === 'single' &&
              fieldRel.relation.target.type === 'single'
            ) {
              if (path.length > 4) {
                continue;
              }

              const currentTarget = current as EntityWithIdAny | undefined;
              const prevTargetEntity = prev as EntityWithIdAny | undefined;

              const targets = getTargets(
                this.pool,
                fieldRel.relation.target.model.name,
                { current: currentTarget?.id, prev: prevTargetEntity?.id },
              );

              singleToSingle(
                {
                  entity,
                  field: fieldRel.relation.source.field,
                  materialisedAs: undefined, //ignore this
                },
                {
                  currentEntity: targets.current,
                  prevEntity: targets.prev,
                  materialisedAs: fieldRel.relation.target.field,
                },
                handledEntityFieldRefs,
              );
            } else if (
              fieldRel.relation.source.type === 'single' &&
              fieldRel.relation.target.type === 'collection'
            ) {
              if (path.length > 4) {
                continue;
              }

              const currentTarget = current as EntityWithIdAny | undefined;
              const prevTargetEntity = prev as EntityWithIdAny | undefined;

              const targets = getTargets(
                this.pool,
                fieldRel.relation.target.model.name,
                { current: currentTarget?.id, prev: prevTargetEntity?.id },
              );

              singleToCollection(
                {
                  entity,
                  field: fieldRel.relation.source.field,
                  materialisedAs: undefined, //ignore this
                },
                {
                  currentEntity: targets.current,
                  prevEntity: targets.prev,
                  materialisedAs: fieldRel.relation.target.field,
                },
                handledEntityFieldRefs,
              );
            } else if (
              fieldRel.relation.source.type === 'collection' &&
              fieldRel.relation.target.type === 'single'
            ) {
              if (path.length > 5) {
                continue;
              }
              if (path.length === 4) {
                continue;
              }

              const currentTarget = current as EntityWithIdAny | undefined;
              const prevTargetEntity = prev as EntityWithIdAny | undefined;

              const targets = getTargets(
                this.pool,
                fieldRel.relation.target.model.name,
                { current: currentTarget?.id, prev: prevTargetEntity?.id },
              );

              collectionToSingle(
                {
                  entity,
                  field: fieldRel.relation.source.field, //ignore this
                  materialisedAs: undefined,
                },
                {
                  currentEntity: targets.current,
                  prevEntity: targets.prev,
                  materialisedAs: fieldRel.relation.target.field,
                },
                handledEntityFieldRefs,
              );
            }
            break;
          }
          case 'materialisedIncoming': {
          }
        }
      }
      //this is a nested field change, atm we don't support refs on nested fields yet so ignore it
    }
  }

  constructor(schema: S, options?: ValtioGraphOptions) {
    this.schema = schema;
    this.viewMap = new Map(
      [schema.rootView, ...schema.views].map((view) => [
        view.model.name,
        {
          view,
          fieldRelations: new Map(
            (view.outgoingRelations ?? [])
              .flatMap<[string, Ref<S>]>((outgoingRelation) => {
                const source: [string, Ref<S>] = [
                  outgoingRelation.source.field,
                  {
                    type: 'source',
                    fieldName: outgoingRelation.source.field,
                    relation: outgoingRelation,
                  },
                ];
                const materialised: [string, Ref<S>] | undefined =
                  outgoingRelation.source.materializedAs
                    ? [
                        outgoingRelation.source.materializedAs,
                        {
                          type: 'materialisedOutgoing',
                          fieldName: outgoingRelation.source.field,
                          relation: outgoingRelation,
                        },
                      ]
                    : undefined;
                if (materialised) {
                  return [source, materialised];
                }

                return [source];
              })
              .concat(
                (view.incomingRelations ?? []).flatMap<[string, Ref<S>]>(
                  (incomingRelation) => {
                    return incomingRelation.target.field
                      ? [
                          [
                            incomingRelation.target.field,
                            {
                              type: 'materialisedIncoming',
                              fieldName: incomingRelation.target.field,
                              relation: incomingRelation,
                            },
                          ],
                        ]
                      : [];
                  },
                ),
              ),
          ),
        },
      ]),
    );
    this.pool = new ValtioPool<S['poolSchema']>(this.schema.poolSchema, {
      listeners: {
        onChange: (name, ops) => {
          const view = this.viewMap.get(name)!;
          this.onPoolEntityChange(name, view, ops);
        },
        onDelete: (discriminatedEntity) => {
          const name = discriminatedEntity.name;
          const entity = discriminatedEntity.entity;
          const view = this.viewMap.get(name)!.view;
          const handledEntityFieldRefs = this.handledEntityFieldRefs.get(name)!;

          //remove this source element from any targets that its materialised on to
          //we do this by performing a normal replace ref but
          // with the "current" target undefined
          if (view.outgoingRelations) {
            for (const outgoingRelation of view.outgoingRelations) {
              if (outgoingRelation.target.field) {
                switch (outgoingRelation.source.type) {
                  case 'single': {
                    const prevTargetId = entity[outgoingRelation.source.field];

                    const targets = getTargets(
                      this.pool,
                      outgoingRelation.target.model.name,
                      { current: undefined, prev: prevTargetId },
                    );
                    switch (outgoingRelation.target.type) {
                      case 'single': {
                        singleToSingle(
                          {
                            entity: entity,
                            //ignore these
                            field: undefined,
                            materialisedAs: undefined,
                          },
                          {
                            currentEntity: targets.current,
                            prevEntity: targets.prev,
                            materialisedAs: outgoingRelation.target.field,
                          },
                          handledEntityFieldRefs,
                        );
                        break;
                      }
                      case 'collection': {
                        singleToCollection(
                          {
                            entity: entity,
                            //ignore these
                            field: undefined,
                            materialisedAs: undefined,
                          },
                          {
                            currentEntity: targets.current,
                            prevEntity: targets.prev,
                            materialisedAs: outgoingRelation.target.field,
                          },
                          handledEntityFieldRefs,
                        );
                        break;
                      }
                    }

                    break;
                  }
                  case 'collection': {
                    if (outgoingRelation.target.type === 'collection') {
                      continue;
                    }
                    //pain
                    const targetIds = entity[
                      outgoingRelation.source.field
                    ] as string[];

                    for (const targetId of targetIds) {
                      const targets = getTargets(
                        this.pool,
                        outgoingRelation.target.model.name,
                        { current: undefined, prev: targetId },
                      );

                      collectionToSingle(
                        {
                          entity: entity,
                          //ignore these
                          field: undefined,
                          materialisedAs: undefined,
                        },
                        {
                          currentEntity: targets.current,
                          prevEntity: targets.prev,
                          materialisedAs: outgoingRelation.target.field,
                        },
                        handledEntityFieldRefs,
                      );
                    }

                    break;
                  }
                }
              }
            }
          }
        },
        postSet: (name, entityProxy) => {
          const view = this.viewMap.get(name)!.view;
          const outputEntity: EntityWithIdAny = entityProxy;
          outputEntity.as = function as() {
            return this;
          };

          const handledEntityFieldRefs = this.handledEntityFieldRefs.get(name)!;
          if (view.outgoingRelations) {
            for (const outgoingRelation of view.outgoingRelations) {
              if (outgoingRelation.source.materializedAs) {
                const materialisedField =
                  outgoingRelation.source.materializedAs;
                switch (outgoingRelation.source.type) {
                  case 'single': {
                    const currentTargetId =
                      outputEntity[outgoingRelation.source.field];

                    const targets = getTargets(
                      this.pool,
                      outgoingRelation.target.model.name,
                      { current: currentTargetId, prev: undefined },
                    );
                    switch (outgoingRelation.target.type) {
                      case 'single': {
                        singleToSingle(
                          {
                            entity: outputEntity,
                            field: undefined,
                            materialisedAs:
                              outgoingRelation.source.materializedAs, //ignore this
                          },
                          {
                            currentEntity: targets.current,
                            prevEntity: targets.prev,
                            materialisedAs: outgoingRelation.target.field,
                          },
                          handledEntityFieldRefs,
                        );
                        break;
                      }
                      case 'collection': {
                        singleToCollection(
                          {
                            entity: outputEntity,
                            field: undefined,
                            materialisedAs:
                              outgoingRelation.source.materializedAs, //ignore this
                          },
                          {
                            currentEntity: targets.current,
                            prevEntity: targets.prev,
                            materialisedAs: outgoingRelation.target.field,
                          },
                          handledEntityFieldRefs,
                        );
                        break;
                      }
                    }

                    break;
                  }
                  case 'collection': {
                    if (outgoingRelation.target.type === 'collection') {
                      continue;
                    }
                    //pain
                    const targetIds = outputEntity[
                      outgoingRelation.source.field
                    ] as string[];

                    outputEntity[materialisedField] = [];
                    for (const targetId of targetIds) {
                      const targets = getTargets(
                        this.pool,
                        outgoingRelation.target.model.name,
                        { current: targetId, prev: undefined },
                      );

                      collectionToSingle(
                        {
                          entity: outputEntity,
                          field: undefined,
                          materialisedAs:
                            outgoingRelation.source.materializedAs, //ignore this
                        },
                        {
                          currentEntity: targets.current,
                          prevEntity: targets.prev,
                          materialisedAs: outgoingRelation.target.field,
                        },
                        handledEntityFieldRefs,
                      );
                    }

                    break;
                  }
                }
              }
            }
          }
          if (view.incomingRelations) {
            for (const incomingRelation of view.incomingRelations) {
              if (incomingRelation.target.field) {
                const materialisedField = incomingRelation.target.field;
                switch (incomingRelation.target.type) {
                  case 'single': {
                    outputEntity[materialisedField] = null;
                    break;
                  }
                  case 'collection': {
                    outputEntity[materialisedField] = [];
                    break;
                  }
                }
              }
            }
          }
        },
      },
    });
    this.handledEntityFieldRefs = new Map(
      [schema.rootView, ...schema.views].map((view) => [
        view.model.name,
        new Set(),
      ]),
    );
  }

  getViews() {
    return this.viewMap;
  }

  getPool(): ValtioPool<S['poolSchema']> {
    return this.pool;
  }

  getRoot(): InferGraphRootResolvedEntity<S> | undefined {
    return this.pool.getRoot();
  }

  createRoot(
    rootSnapshot: InferPoolRootEntityWithId<S['poolSchema']>['entity'],
    entities?: InferPoolEntityWithId<S['poolSchema']>[],
  ): InferGraphRootResolvedEntity<S> {
    return this.pool.createRoot(rootSnapshot, entities);
  }

  create<T extends InferPoolEntityName<S['poolSchema']>>(
    name: T,
    entity: Extract<
      InferPoolEntityWithId<S['poolSchema']>,
      { name: T }
    >['entity'],
  ): InferView<Extract<InferGraphView<S>, { model: { name: T } }>> {
    return this.pool.createEntity({ name, entity });
  }

  get<T extends InferPoolEntityName<S['poolSchema']>>(
    name: T,
    id: string,
  ): InferView<Extract<InferGraphView<S>, { model: { name: T } }>> | undefined {
    return this.pool.getEntity(name, id);
  }

  delete<T extends InferPoolEntityName<S['poolSchema']>>(
    name: T,
    id: string,
  ): void {
    this.pool.getState().delete(name, id);
  }
}

type RelationEntities = {
  sourceEntity: EntityWithIdAny;
  currentTargetEntity: EntityWithIdAny | undefined;
  prevTargetEntity: EntityWithIdAny | undefined;
};
//seems dumb
function getTargets<S extends PoolSchemaAny>(
  pool: ValtioPool<S>,
  name: InferPoolEntityName<S>,
  targets: { current: string | undefined; prev: string | undefined },
) {
  const prevTargetEntity = (
    targets.prev ? pool.getEntity(name, targets.prev) : undefined
  ) as EntityWithIdAny | undefined;

  const currentTargetEntity = (
    targets.current ? pool.getEntity(name, targets.current) : undefined
  ) as EntityWithIdAny | undefined;
  return { prev: prevTargetEntity, current: currentTargetEntity };
}

function getEntityAny<S extends PoolSchemaAny>(
  pool: ValtioPool<S>,
  name: InferPoolEntityName<S>,
  id: string,
) {
  return pool.getEntity(name, id) as
    | { readonly id: string; [key: string]: any }
    | undefined;
}

function singleToSingle(
  source: {
    entity: EntityWithIdAny;
    field: string | undefined;
    materialisedAs: string | undefined;
  },
  target: {
    currentEntity: EntityWithIdAny | undefined;
    prevEntity: EntityWithIdAny | undefined;
    materialisedAs: string | undefined;
  },
  handledFields: Set<string>,
) {
  if (target.currentEntity && source.field) {
    //set the source field
    source.entity[source.field] = target.currentEntity.id;
    handledFields.add(entityFieldRef(source.entity.id, source.field));
  }
  if (source.materialisedAs) {
    //replace materialised ref on source
    source.entity[source.materialisedAs] = target.currentEntity;
    handledFields.add(entityFieldRef(source.entity.id, source.materialisedAs));
  }

  if (target.materialisedAs) {
    //remove materalised ref on prev target entity
    if (target.prevEntity) {
      target.prevEntity[target.materialisedAs] = undefined;
      //should I be doing this on the prev entity?
      handledFields.add(
        entityFieldRef(target.prevEntity.id, target.materialisedAs),
      );
    }
    //add materialised ref to new target entity
    if (target.currentEntity) {
      target.currentEntity[target.materialisedAs] = source.entity;
      handledFields.add(
        entityFieldRef(target.currentEntity.id, target.materialisedAs),
      );
    }
  }
}

function singleToCollection(
  source: {
    entity: EntityWithIdAny;
    field: string | undefined;
    materialisedAs: string | undefined;
  },
  target: {
    currentEntity: EntityWithIdAny | undefined;
    prevEntity: EntityWithIdAny | undefined;
    materialisedAs: string | undefined;
  },
  handledFields: Set<string>,
) {
  if (target.currentEntity && source.field) {
    //set the source field
    source.entity[source.field] = target.currentEntity.id;
    handledFields.add(entityFieldRef(source.entity.id, source.field));
  }

  if (source.materialisedAs) {
    //replace materialised ref on source
    source.entity[source.materialisedAs] = target.currentEntity;
    handledFields.add(entityFieldRef(source.entity.id, source.materialisedAs));
  }

  //replace materialised target field
  if (target.materialisedAs) {
    //the field is an array so this is a bit more involved

    //remove materalised ref on prev target entity
    if (target.prevEntity) {
      const ref = target.prevEntity[target.materialisedAs] as EntityWithIdAny[];
      if (ref) {
        const index = ref.findIndex((item) => item.id === source.entity.id);
        ref.splice(index, 1);
      }
      handledFields.add(
        entityFieldRef(target.prevEntity.id, target.materialisedAs),
      );
    }
    //add materialised ref to new target entity
    if (target.currentEntity) {
      const ref = target.currentEntity[
        target.materialisedAs
      ] as EntityWithIdAny[];
      if (ref) {
        ref.push(source.entity);
      } else {
        target.currentEntity[target.materialisedAs] = [source.entity];
      }
      handledFields.add(
        entityFieldRef(target.currentEntity.id, target.materialisedAs),
      );
    }
  }
}

function collectionToSingle(
  source: {
    entity: EntityWithIdAny;
    field: string | undefined;
    materialisedAs: string | undefined;
  },
  target: {
    currentEntity: EntityWithIdAny | undefined;
    prevEntity: EntityWithIdAny | undefined;
    materialisedAs: string | undefined;
  },
  handledFields: Set<string>,
) {
  if (target.currentEntity && source.field) {
    //set the source field
    const ref = source.entity[source.field] as string[] | undefined;
    if (ref) {
      ref.push(target.currentEntity.id);
    } else {
      source.entity[source.field] = [target.currentEntity.id];
    }
    handledFields.add(
      entityPathRef(source.entity.id, [
        source.field,
        (source.entity[source.field].length - 1).toString(),
      ]),
    );
  }
  if (source.materialisedAs && target.currentEntity) {
    //replace materialised ref on source
    const ref = source.entity[source.materialisedAs] as
      | EntityWithIdAny[]
      | undefined;
    if (ref) {
      ref.push(target.currentEntity);
    } else {
      source.entity[source.materialisedAs] = [target.currentEntity];
    }
    handledFields.add(
      entityPathRef(source.entity.id, [
        source.materialisedAs,
        (source.entity[source.materialisedAs].length - 1).toString(),
      ]),
    );
  }

  if (target.materialisedAs) {
    //remove materalised ref on prev target entity
    if (target.prevEntity) {
      target.prevEntity[target.materialisedAs] = undefined;
      //should I be doing this on the prev entity?
      handledFields.add(
        entityFieldRef(target.prevEntity.id, target.materialisedAs),
      );
    }
    //add materialised ref to new target entity
    if (target.currentEntity) {
      target.currentEntity[target.materialisedAs] = source.entity;
      handledFields.add(
        entityFieldRef(target.currentEntity.id, target.materialisedAs),
      );
    }
  }
}