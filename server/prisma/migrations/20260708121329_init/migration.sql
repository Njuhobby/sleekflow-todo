-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('not_started', 'in_progress', 'completed', 'archived');

-- CreateTable
CREATE TABLE "todos" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "due_date" TIMESTAMP(3),
    "status" "Status" NOT NULL DEFAULT 'not_started',
    "priority" "Priority" NOT NULL DEFAULT 'medium',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),
    "recurrence" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "todos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "todo_dependencies" (
    "dependent_id" TEXT NOT NULL,
    "dependency_id" TEXT NOT NULL,

    CONSTRAINT "todo_dependencies_pkey" PRIMARY KEY ("dependent_id","dependency_id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "todo_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "todos_deleted_at_status_idx" ON "todos"("deleted_at", "status");

-- CreateIndex
CREATE INDEX "todos_deleted_at_priority_idx" ON "todos"("deleted_at", "priority");

-- CreateIndex
CREATE INDEX "todos_deleted_at_due_date_idx" ON "todos"("deleted_at", "due_date");

-- CreateIndex
CREATE INDEX "todos_deleted_at_name_idx" ON "todos"("deleted_at", "name");

-- CreateIndex
CREATE INDEX "todo_dependencies_dependency_id_idx" ON "todo_dependencies"("dependency_id");

-- CreateIndex
CREATE INDEX "activities_todo_id_created_at_idx" ON "activities"("todo_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "todo_dependencies" ADD CONSTRAINT "todo_dependencies_dependent_id_fkey" FOREIGN KEY ("dependent_id") REFERENCES "todos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_dependencies" ADD CONSTRAINT "todo_dependencies_dependency_id_fkey" FOREIGN KEY ("dependency_id") REFERENCES "todos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
