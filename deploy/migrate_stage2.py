import sqlite3
DB = "/opt/clmx/server/prisma/dev.db"
conn = sqlite3.connect(DB)
cur = conn.cursor()

# 1. AiModel 加 domain 列（默认 NLP，不丢数据）
try:
    cur.execute("ALTER TABLE AiModel ADD COLUMN domain TEXT NOT NULL DEFAULT 'NLP'")
    print("AiModel.domain added")
except Exception as e:
    print("AiModel.domain skip:", e)

# 2. ModelVersion 加 dataType 列
try:
    cur.execute("ALTER TABLE ModelVersion ADD COLUMN dataType TEXT")
    print("ModelVersion.dataType added")
except Exception as e:
    print("ModelVersion.dataType skip:", e)

# 3. TrainingJob.datasetVersionId 去 NOT NULL（工业训练不绑定文本数据集）
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='TrainingJob_new'")
if not cur.fetchone():
    cur.execute("""CREATE TABLE TrainingJob_new (
        id TEXT PRIMARY KEY,
        modelId TEXT NOT NULL,
        modelVersionId TEXT,
        datasetVersionId TEXT,
        evalDatasetVersionId TEXT,
        hyperparams TEXT,
        status TEXT NOT NULL DEFAULT 'QUEUED',
        progress INTEGER NOT NULL DEFAULT 0,
        currentEpoch INTEGER NOT NULL DEFAULT 0,
        totalEpochs INTEGER NOT NULL DEFAULT 3,
        gpuType TEXT NOT NULL DEFAULT 'NVIDIA-T4',
        gpuCount INTEGER NOT NULL DEFAULT 1,
        lossHistory TEXT,
        startedAt DATETIME,
        completedAt DATETIME,
        callbackToken TEXT,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    cur.execute("""INSERT INTO TrainingJob_new
        SELECT id,modelId,modelVersionId,datasetVersionId,evalDatasetVersionId,hyperparams,
               status,progress,currentEpoch,totalEpochs,gpuType,gpuCount,lossHistory,
               startedAt,completedAt,callbackToken,createdAt
        FROM TrainingJob""")
    cur.execute("DROP TABLE TrainingJob")
    cur.execute("ALTER TABLE TrainingJob_new RENAME TO TrainingJob")
    print("TrainingJob.datasetVersionId made optional")
else:
    print("TrainingJob already migrated")

conn.commit()
conn.close()
print("MIGRATE_OK")
