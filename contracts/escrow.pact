(module kadena-earn GOVERNANCE
  (defcap GOVERNANCE ()
    (enforce-guard (at 'admin (read config "global"))))
  (defcap OPS ()
    (enforce-guard (at 'ops (read config "global"))))
  (defcap ESCROW ()
    (require-capability (OPS)))

  (defschema config-schema admin:guard ops:guard sponsor:string paused:bool)
  (deftable config:{config-schema})
  (defschema campaign-schema
    sponsor:string sponsor-guard:guard reward:decimal slots:integer deadline:time
    funded:decimal paid:decimal refunded:decimal paid-count:integer reserved-count:integer)
  (deftable campaigns:{campaign-schema})
  (defschema claim-schema campaign:string recipient:string state:string)
  (deftable claims:{claim-schema})
  (defschema payment-schema campaign:string recipient:string amount:decimal paid-at:time)
  (deftable payments:{payment-schema})

  (defconst ESCROW-ACCOUNT:string "__ESCROW_ACCOUNT__")
  (defun now:time () (at 'block-time (chain-data)))
  (defun running:bool ()
    (enforce (not (at 'paused (read config "global"))) "Emergency pause is active"))
  (defun recipient-guard:guard (account:string)
    (enforce (= (take 2 account) "k:") "Only k: accounts are supported")
    (enforce (= (length account) 66) "Invalid k: account")
    (let ((ks (read-keyset "recipient-keyset")))
      (enforce (= (create-principal ks) account) "Invalid principal account")
      ks))

  (defun create-and-fund:string (id:string sponsor:string reward:decimal slots:integer deadline:time)
    (with-capability (GOVERNANCE)
    (running)
    (enforce (= sponsor (at 'sponsor (read config "global"))) "Only the owner funds campaigns")
    (enforce-guard (recipient-guard sponsor))
    (enforce (> reward 0.0) "Reward must be positive")
    (enforce (= reward (round reward 6)) "At most six decimal places")
    (enforce (and (> slots 0) (<= slots 10000)) "Invalid slots")
    (enforce (> deadline (now)) "Deadline must be in the future")
    (let ((pool (* reward slots)))
      (insert campaigns id { 'sponsor: sponsor, 'sponsor-guard: (recipient-guard sponsor),
        'reward: reward, 'slots: slots, 'deadline: deadline, 'funded: pool,
        'paid: 0.0, 'refunded: 0.0, 'paid-count: 0, 'reserved-count: 0 })
      (coin.transfer-create sponsor ESCROW-ACCOUNT (create-capability-guard (ESCROW)) pool))
    id))

  ;; Reserve accepted proof on chain BEFORE exposing it to the review queue.
  ;; This keeps late approvals funded when the deadline refund runs.
  (defun reserve-claim:string (id:string payment-id:string recipient:string)
    (with-capability (OPS)
      (running)
      (recipient-guard recipient)
      (with-read campaigns id { 'deadline:= deadline, 'slots:= slots,
        'paid-count:= paid, 'reserved-count:= reserved }
        (enforce (< (now) deadline) "Campaign deadline has passed")
        (enforce (< (+ paid reserved) slots) "No reward slots remain")
        (insert claims payment-id { 'campaign: id, 'recipient: recipient, 'state: "reserved" })
        (update campaigns id { 'reserved-count: (+ reserved 1) }))
      payment-id))

  (defun pay-reward:string (id:string payment-id:string recipient:string)
    (with-capability (OPS)
      (running)
      (with-read claims payment-id { 'campaign:= campaign, 'recipient:= payee, 'state:= state }
        (enforce (= campaign id) "Wrong campaign")
        (enforce (= payee recipient) "Wrong recipient")
        (enforce (= state "reserved") "Claim already settled"))
      (with-read campaigns id { 'reward:= reward, 'paid:= paid, 'refunded:= refunded,
        'funded:= funded, 'paid-count:= count, 'slots:= slots, 'reserved-count:= reserved }
        (enforce (< count slots) "Reward limit reached")
        (enforce (>= (- funded (+ paid refunded)) reward) "Insufficient escrow")
        (insert payments payment-id { 'campaign: id, 'recipient: recipient, 'amount: reward, 'paid-at: (now) })
        (update claims payment-id { 'state: "paid" })
        (update campaigns id { 'paid: (+ paid reward), 'paid-count: (+ count 1), 'reserved-count: (- reserved 1) })
        (with-capability (ESCROW)
          (install-capability (coin.TRANSFER ESCROW-ACCOUNT recipient reward))
          (coin.transfer-create ESCROW-ACCOUNT recipient (recipient-guard recipient) reward)))
      payment-id))

  (defun release-claim:string (id:string payment-id:string)
    (with-capability (OPS)
      (with-read claims payment-id { 'campaign:= campaign, 'state:= state }
        (enforce (= campaign id) "Wrong campaign")
        (enforce (= state "reserved") "Claim already settled"))
      (with-read campaigns id { 'reserved-count:= reserved }
        (update campaigns id { 'reserved-count: (- reserved 1) }))
      (update claims payment-id { 'state: "rejected" })
      payment-id))

  ;; A worker calls this after the deadline, and again after late rejections.
  ;; Already-refunded amounts are excluded; reserved work stays payable.
  (defun refund-unused:decimal (id:string)
    (with-capability (OPS)
      (with-read campaigns id { 'deadline:= deadline, 'funded:= funded, 'paid:= paid,
        'refunded:= refunded, 'reserved-count:= reserved, 'reward:= reward,
        'sponsor:= sponsor, 'sponsor-guard:= sponsor-guard }
        (enforce (>= (now) deadline) "Campaign is still accepting work")
        (let ((amount (- (- (- funded paid) refunded) (* reward reserved))))
          (enforce (> amount 0.0) "Nothing refundable")
          (update campaigns id { 'refunded: (+ refunded amount) })
          (with-capability (ESCROW)
            (install-capability (coin.TRANSFER ESCROW-ACCOUNT sponsor amount))
            (coin.transfer-create ESCROW-ACCOUNT sponsor sponsor-guard amount))
          amount))))

  (defun set-global-pause:bool (paused:bool)
    (with-capability (GOVERNANCE)
      (update config "global" { 'paused: paused })
      paused))
  (defun get-campaign:object (id:string) (read campaigns id))
  (defun get-claim:object (id:string) (read claims id))
  (defun get-payment:object (id:string) (read payments id))
  (defun get-config:object () (read config "global"))
)
(create-table kadena-earn.config)
(create-table kadena-earn.campaigns)
(create-table kadena-earn.claims)
(create-table kadena-earn.payments)
(insert kadena-earn.config "global" { 'admin: (read-keyset "admin-keyset"),
  'ops: (read-keyset "ops-keyset"), 'sponsor: (read-string "sponsor"), 'paused: false })
