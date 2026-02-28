function calculateComplaintPriority(c){
    let score=0;

    //weight based on status
    if(c.status=="Pending") score +=20;
    if(c.status=="In Progress") score +=10;

    //upvote weight
    score += (c.upvotes || 0)*3;
    //serious keywords
    const seriousWords=[
        "bullying",
        "harassment",
        "ragging",
        "voilence",
        "threat",
        "abuse"
    ];

    seriousWords.forEach(word=>{
        if(
            c.title?.toLowerCase().includes(word) ||
            c.description?.toLowerCase().includes(word)
        ){
            score +=25;
        }
    });
    return score;
}
function calculateComplaintPriority(complaint) {
  let score = 0;

  // Base upvote weight
  score += (complaint.upvotes || 0) * 5;

  // Proof weight
  if (complaint.proof_count && complaint.proof_count > 0) {
    score += 25;
  }

  // Category weight (optional)
  if (complaint.category === "harassment") {
    score += 40;
  }

  // 🔥 Overdue escalation
  if (complaint.ticket_deadline) {
    const now = new Date();
    const deadline = new Date(complaint.ticket_deadline);

    if (deadline < now && complaint.status !== "Resolved") {
      score += 30; // escalation weight
    }
  }

  return score;
}
function calculateComplaintPriority(complaint) {

  let score = 0;

  // Category weight
  if (complaint.category === "harassment") score += 40;

  // Upvotes weight
  if (complaint.upvotes > 5) score += 20;

  // Proof weight
  if (complaint.proof_count > 0) score += 15;

  // Overdue weight
  if (complaint.is_overdue) score += 30;

  return score;
}


module.exports=calculateComplaintPriority;